# ADR-0022: A topic binding key may have at most two `#` wildcards

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara
- **Extends:** rule 4 ("Topic exchanges") of [ADR-0008](0008-rabbitmq-fidelity-baseline.md). It adds a limit that the rule does not mention.

## Context

Rule 4 of ADR-0008 says what `*` and `#` match. It does not say how many of them a binding key may have. While recording
the truth table of the topic matcher for S1 ([#3](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/3)), every
pattern of up to three words against every key of up to three words, RabbitMQ 4.3.6 refused the pattern `#.#.#`.

The rest of the table agrees with rule 4. Of the 3,828 pattern and key pairs recorded across the topic scenarios, none
differs from a literal reading of the rule. That includes the empty key: it has zero words, so `#` matches it and `*`
does not.

## Decision

**A binding key on a topic exchange may have at most two words that are `#`.** A third is refused when the binding is
made, with `406 PRECONDITION_FAILED`, and the broker closes the channel. Nothing is bound:

```text
PRECONDITION_FAILED - Topic binding key '#.#.#' uses 3 '#' wildcards, at most 2 are allowed
```

The number in the text is the number of `#` words that the key has.

- It counts whole words that are exactly `#`. `##.#.#` has two, because `##` is an ordinary word. `a.#.b.#.c` and
  `*.#.*.#.*` are accepted. `a.#.b.#.c.#`, `#.#.a.#` and `#.*.#.*.#` are refused.
- It applies to a binding to a queue and to a binding to another exchange alike.
- It applies only to a **topic** exchange. On a direct exchange `#.#.#` is an ordinary key, and a fanout or a headers
  exchange does not look at the key.
- `*` has no such limit. A key of 128 of them, which is 255 bytes, is accepted.
- The simulator reproduces the refusal, with this code and text. The domain's validation refuses the binding, and the
  editor can say why before the learner gets there. The engine's `route()` has no rule for it, because it is given a
  topology that has no such binding.

The recordings are `routing/a-topic-binding-key-with-three-hash-wildcards-is-refused` and the topic scenarios beside it,
in [`web/fixtures/conformance/4.3/routing/`](../../web/fixtures/conformance/4.3/routing). This adds a row to the table of
refusals in [ADR-0021](0021-transient-queues-are-refused.md):

| What a client does | The broker answers | It closes | ADR-0008 |
|---|---|---|---|
| Binds a topic exchange with a key that has three or more `#` words | `406 PRECONDITION_FAILED - Topic binding key 'k' uses N '#' wildcards, at most 2 are allowed` | the channel | extends rule 4 |

## Consequences

### Positive

- A learner who writes `#.#.#` gets the broker's own reason, and not a silently different topology.
- The matcher's truth table is complete for every pattern that can exist. The one pattern of three words that is left
  out of it is the one that cannot be bound.

### Negative / trade-offs

- The limit is a number that the broker may change in a later release. The text says "at most 2", so the Nightly run
  would show it.
- A pattern with three `#` words that arrives some other way, such as an imported `definitions.json`, has to be refused
  by the importer as well. S10 does that.

## Alternatives considered

- **Accept any number of `#` and match them.** Rejected: the simulator would let a learner build a binding that the
  broker refuses.
- **Leave the limit out and say nothing.** Rejected: a learner who copies a topology to a real broker would find out
  there, with no explanation.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md): rule 4.
- [ADR-0021](0021-transient-queues-are-refused.md): the other refusals that the simulator reproduces.
- [M1 plan](../plans/m1.md), section 5.
