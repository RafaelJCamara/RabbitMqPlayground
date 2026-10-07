# ADR-0059: A topic miss is aligned from both ends, and `explainMiss` gives each exchange once

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** rule 4 of [ADR-0008](0008-rabbitmq-fidelity-baseline.md) (topic matching), [ADR-0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md),
  "Events" of [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md) (`routed` and `unroutable` carry the trace) and the trace and `explainMiss` of S1, for what S7
  ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) renders. It answers question 6 of [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md).

## Context

S7 draws the trace of `route()` and the answer of `explainMiss`. Question 6 listed four doubts about their shape, and S6 left a fifth: whether an event should carry the explanation of a miss. They were decided by playing the 91 routing fixtures through the engine
(599 publishes, with the topology that each had at the time) and reading what came out, with a script that is not kept. What it showed:

- **`route()` and `explainMiss` never disagree** about which queues were reached: 599 publishes, every queue of each.
- **Half of the topic misses of a pattern with a `#` read oddly.** Of 1,130 such misses, 432 ended on `key-ran-out` and 121 on `key-has-extra-words`. For `#.x` against `k.y` the old alignment says that the `#` took `k.y` and that `x` has nothing left, and for `#.a`
  against `a.b` that `b` is "extra". Both are true of a left-to-right walk, and neither is what a person means: the key has to *end* in `x`, and it ends in `y`.
- **`explainMiss` grows with the number of paths and not with the size of the canvas.** It lists a reason for each binding that points at an exchange that was not reached, and goes into each of them again. A ladder of diamonds, each level two exchanges that both feed the
  next, gives 1.5 MB of JSON at 12 levels (36 exchanges) and 24 MB and 387 ms at 16. A canvas that a learner can build freezes the page on "why didn't it get here?".
- **129 of the explanations ended on a `cycle`**, which says that a path came back to an exchange that it was already explaining. That is a right and a useful ending: it tells the learner that the exchanges only lead into each other.
- **The default exchange is a visit with one implicit binding or none** (39 evaluations): the queue named by the key, or nothing.

## Decision

### A topic alignment covers the whole pattern, anchored at both ends

- **`alignTopic` gives a segment for every word of the pattern**, `{ pattern, words, outcome }`. A `#` always took what is between its neighbours. Any other word is `matched` (it took the key word that fits), `differs` (a word of the pattern met another word, which it keeps in
  `words` so that a cell can show it) or `missing` (the key had no word left for it). A match has every segment `matched`, and the key words that no segment took are `key.slice(miss.keyIndex)` for a miss of the pattern that ran out.
- **The words before the first `#` are anchored to the start of the key, the words after the last `#` to its end, and the words between two `#` are looked for from left to right in what is left**, each in the first place where it fits. A pattern with no `#` is all anchor.
  Each word is judged on its own, so the cells show every word that is wrong and not only the first. A match is aligned the same way, and gives what it gave before (a `#` takes as few words as it can, so that what follows is matched first).
- **`miss` says the first problem**, in this order:
  1. `word-differs { patternIndex, keyIndex }`: the first word of the part before the first `#` that the key's word is not;
  2. `key-too-short { needs, has }`: the key has fewer words than the pattern has words that are not `#`, and no `#` can make up for that (it replaces `key-ran-out`, which said which word of the pattern was left without one, and with a `#` it was not a word that could be told);
  3. `key-has-extra-words { keyIndex }`: a pattern with no `#` that is used up, and the key goes on;
  4. `word-differs` again, for the first word of the part after the last `#` that does not fit the end of the key;
  5. `middle-not-found { patternIndex }`: the words between two `#` are nowhere in the key, in order, and `patternIndex` is the first of them.
  The check that the key is long enough comes after the words before the first `#` and before the words after the last one, because the last words of a key too short to hold the pattern are not a fault of their own.
- **`matched` is still decided by `topicMatches`.** The alignment is a second derivation, and a property says that they agree: `matched` exactly when every segment is `matched` and no key word is left over, and a miss has a reason that a segment bears out.
- **Words are compared as they were: byte for byte, and `a*` is an ordinary word.** An empty key has no words, so `*` is `missing` against it, which is rule 4 and is worth saying in the sentence.

### `explainMiss` gives each exchange once

- **An exchange is explained at the first place that it is met, and is a reference after that.** The reasons for an exchange that was not reached are given once, under the first binding that points at it. The next binding that points at the same exchange says `already-explained { exchange }`, and one that
  points back at an exchange that is being explained still says `cycle { exchange }`. So the answer has at most one reason for each binding of the topology, whatever the number of paths, and a property holds the bound on a ladder of 40 levels.
- **Nothing else about its shape changes**: `refused`, `no-such-queue`, `default-exchange`, `no-bindings`, `binding-did-not-match` and `exchange-not-reached` are as they were, and `reached` still says whether `route()` reached the queue.

### What stays as it is

- **The default exchange** is a visit with the one implicit binding that matched, or with none. Showing a binding for every queue would add the number of queues to every message that goes through it, in the hot path and in every event that the log keeps, to say what the explanation can derive
  when it is asked for: it has the topology, and the other queues are the ones whose names are not the key.
- **`topicSamples`** keeps `x`, `y` and `z`, an empty word for a `*`, at most four keys that match and five that do not, and none over 255 bytes. The samples are for a person typing a pattern, and a placeholder that is not a word of a real canvas is the point.
  Where a sample shows a rule that surprises (the empty word of a `*`), the tester says so.
- **An event does not carry the explanation of a miss.** An explanation of why a queue did not get a message has one answer for each queue that did not, which is the number of queues times the number of bindings for every message of a burst. It is worked out again, exactly, from the topology
  that routed the message and the message (`route()` is a function), and the log keeps, for each message that it holds, the document that routed it ([ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md)).
  A canvas that changed afterwards does not change what the learner is told about a message that went by.

## Consequences

### Positive

- The alignment of a miss is read as a person reads a pattern: from the ends in, with every wrong word marked, and the sentence says the first one.
- "Why didn't it get here?" costs the size of the canvas, so that the page cannot be frozen by a ladder, and the 200-node canvas of the performance journey can be asked.
- The events and the trace stay as they were, so the engine's replay of the fixtures, its snapshots and the overlay are not touched.

### Negative / trade-offs

- `TopicAlignment` changes shape (`segments` is the whole pattern, with an outcome), and `key-ran-out` goes. Nothing outside the engine's own specs read them yet, which is why this is the time.
- A second derivation of topic matching is more code to keep equal to the first, and a property is what keeps it so.
- A reference to an exchange that was explained elsewhere makes the reader look for it. The sentence names the exchange, and the tree shows it once.

## Alternatives considered

- **Keep the left-to-right alignment and word the odd cases.** Rejected: the sentence would have to know that a `#` ate the rest, which is the alignment knowing something that it does not say.
- **Report the last word that differed.** Rejected: for a pattern with a `#` it is the last word of the key, which is right for the part after the `#` and wrong for the part before it, and the reading above says which.
- **Memoise `explainMiss` by exchange and keep the tree.** Rejected: the answer is data that a screen renders and a file prints, and a tree that shares nodes is a graph that is read as a tree and grows again.
- **An implicit binding for every queue in the trace of the default exchange.** Rejected above.
- **Carry the explanation in the events.** Rejected above.

## Related

- [ADR-0007](0007-deterministic-simulation-engine.md), [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md).
- [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md): what renders them.
- [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md), question 6 (answered and removed).
