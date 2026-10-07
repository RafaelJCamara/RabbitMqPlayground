# ADR-0064: The what-if and the topic tester read the canvas and change nothing, and `explain` is one flag in two halves

- **Status:** Accepted. The row of the key `E` names both flags, `simulation` and `explain`, which is how it is "not offered while the simulation is off": [ADR-0065](0065-what-building-s7-settled-the-key-of-the-log-names-both-flags-a-tester-that-is-open-is-what-is-lit-and-a-tester-follows-the-text-that-is-typed.md).
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "What-if tester" and "Inline topic tester" of [ADR-0010](0010-explanation-first-editor-ux.md), the key popover of [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md), the table of shortcuts of
  [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md), the flags of [ADR-0004](0004-trunk-based-development-on-main.md), "One command layer" of [ADR-0011](0011-explicit-linking-and-command-layer.md) and what is tested of
  [ADR-0036](0036-the-test-strategy-of-the-editor.md), for the rest of what S7 ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) builds.

## Context

Two of the explanation's tools ask nothing of the simulation: a tester that says where a message would go on the canvas as it is, and one that says what a binding key matches while it is being typed. The rest (the log, the message, Why?) needs events. S7 is behind one flag, `explain`, which stays off by default until S12.
ADR-0011 wants a command for every gesture that changes the canvas, and none of these changes anything.

## Decision

### The what-if tester

- **It is a part of the inspector region**, "What if…?", under what is selected, closed by default and opened by its button (`aria-expanded`). It is there with `explain` alone. It does not depend on what is selected, so a learner can keep it open and select around; an exchange that is selected when it is opened is the one it asks about.
- **It takes an exchange from a list and the message in the text form of the command.** The list is the canvas's exchanges and the default exchange, which a canvas may not be showing. The message is one line, `key=order.created header:format=pdf header:n=1`, which is what follows the exchange in `publish` (ADR-0054, ADR-0025), read by the same reader
  ([`parseMessageText`, ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md)), so that `1` and `"1"` are an integer and a string here as they are there, and a refusal is the grammar's, with its suggestion, under the field. S8 gives it the table of headers.
- **It runs `explainRoute` over the topology of the canvas and nothing else.** It does not publish, does not call the bus or the engine, writes nothing to the log of commands or of events, and leaves the document, the selection, the history and the counters as they were, which a spec holds by reading each. It is worked out again for every
  change of the text, of the exchange and of the canvas, with no timer, as a `computed` over those signals.
- **It says the answer first and the reasons after**: "Would reach billing and audit." or "No queue would get it.", and for a message that the broker refuses the refusal. The queues that would receive it are listed, the tree of the explanation is below, folded, and the canvas is lit as for a Why? ([ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md))
  for as long as the part is open and the line can be read. With the simulation on, it ends with the line that would send it for real (`publish orders key=order.created header:format=pdf`), as text.

### The inline topic tester

- **It is a small component that takes the text of a binding key and lists keys.** It shows `topicSamples` (ADR-0059) as two lists, the keys that match and the keys that do not, with each key as it is written and, for a key that does not match, the sentence of its first problem, and a note where a sample shows what surprises (a `*` that took an empty
  word). It runs as the learner types, with no timer: the text goes in as a signal, and the samples are a `computed`.
- **An invalid key says why and shows no samples**: a third `#` (ADR-0022) says that a binding key may have two, with the number that it has, and a key over 255 bytes says that it is too long, with the number of bytes. They are the words of the domain's own checks, so a key that the tester refuses is a key that the binding refuses, and the other way round.
- **It runs where a topic key is typed**: in the key popover of S5 when the exchange is a topic exchange (the popover gets the type of the exchange, and is taller for it, which its placement knows), and under the key fields of a topic edge in the inspector, for the field that is being typed in. It needs `explain` alone.

### The flag, in two halves

- **`explain` is off by default**, and `flags.spec.ts` holds it for every flag. With `editor` and `explain`: the what-if tester and the topic tester. With `editor`, `simulation` and `explain`: also the event log and its button in the strip and its key, the message in the inspector and the buttons that open it, the card, Why? and "why didn't it get here?", and the press on a marker.
  With `simulation` alone nothing of S7 is there. Both combinations are tested, in the unit tier and in a browser.
- **The key `E`** shows or hides the event log. It is a row of the table of shortcuts with `flag: 'explain'`, a single character and so for the canvas only (WCAG 2.1.4, which the spec of the table holds), and it does nothing and is not offered while the simulation is off.

### What is not added, and what a test can read

- **No typed verb.** ADR-0011's rule is for what changes the canvas, and an explanation changes nothing: the log, the card and the testers are views. The text of the what-if is the tail of a verb that exists, `publish`, and the line that would send it is shown. If a lesson wants "explain this route" as a command, it is a verb with scope `app`, and goes through the registry, `npm run docs:generate`, completion, help and specs.
- **Two read-only names on the debug handle**, behind `RMQ_E2E`: `explainEventLog` (the rows that the panel could show, the filter, the count that was dropped and the row that is chosen) and `explainEmphasis` (what is lit, with the short reasons), so that a journey reads what the page says and not the pixels. Both are in the list that `check-bundle` refuses, in CI and
  in the gates, and neither is a name that the app uses for anything else, since a class field is never renamed by the build and a name that a field shares would fail the check.

## Consequences

### Positive

- A learner can ask "where would this go?" before building anything that publishes, and learn a pattern while writing it.
- The two tools that need no events work with the flag half on, and the half that needs them is not there when it cannot work.
- Nothing about the commands, the grammar or the reference changes, so `docs/commands.md` is not touched.

### Negative / trade-offs

- A learner who wants to try a message and then send it types the line, or pastes it. A button that sends the what-if is a way to change the canvas's simulation that would have to be a command, and is left for a lesson that asks for it.
- The tester reads headers in the text form until S8, which is how the command bar takes them.
- The popover for a topic exchange is taller, and a window that is short has it placed higher.

## Alternatives considered

- **A dialog for the what-if.** Rejected: ADR-0010 has no modal dialogs for editing, and the canvas has to be seen while it is asked.
- **A tester in the toolbox.** Rejected: the toolbox adds nodes, and the inspector is where a learner looks to ask about the canvas.
- **A debounce on the topic tester.** Rejected: the computation is a few microseconds, and a timer is what a test would have to wait for.
- **Show the tester for every exchange type.** Rejected: only a topic key has wildcards.
- **A verb for the what-if.** Rejected above.

## Related

- [ADR-0004](0004-trunk-based-development-on-main.md), [ADR-0009](0009-headers-exchange-support.md), [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md),
  [ADR-0036](0036-the-test-strategy-of-the-editor.md), [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md).
- [ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md), [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md),
  [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md), [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md),
  [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md).
