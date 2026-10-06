# ADR-0024: A queue that is not durable is refused, with the root cause first and the broker's reply after it

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0021](0021-transient-queues-are-refused.md). It settles what the M1 model's `durable` flag on a queue
  means, which that ADR left open.

## Context

[ADR-0021](0021-transient-queues-are-refused.md) says that RabbitMQ 4.3 refuses a queue that is neither durable nor
exclusive: `541 INTERNAL_ERROR`, and the connection is closed. The M1 model gives a queue `durable` and no `exclusive`
([plan, section 2.1](../plans/m1.md)), and the plan's default interpretations say that the flag is "stored, shown and
exported" and that its lifecycle arrives in M3. Together that makes a queue with `durable` off a queue that the broker
would refuse. S2 ([#4](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/4)) had to decide what the flag means
before it could write the schema.

There were three options: every queue durable, with the toggle shown and fixed; the toggle works, and off is a validation
error that carries the broker's `541` text; or an `exclusive` flag in M1, so that a queue that is not durable is possible
and goes with its connection. The repo owner chose the second, with two conditions: the message the learner gets has to
make the root cause clear, and the scenario has to be in the tests.

## Decision

**The flag works, and a queue with it off is refused, as the broker refuses it.**

- `durable` stays an attribute of a queue: stored, shown and exported. It is `true` for every queue that can be on a
  canvas. The flag of an exchange is not affected: the broker accepts an exchange that is not durable.
- A queue cannot get to `durable: false` by any road. `declare queue q durable=false`, `set q durable=false` and a document
  that has such a queue (one that is loaded, imported or shared, which is not made by commands) are all refused with the
  same issue.
- **The issue says why first.** Its `message` is a plain sentence about the root cause and what to do: that the queue is
  not durable, that RabbitMQ 4.3 no longer allows a queue that is neither durable nor exclusive because that is a
  deprecated feature (`transient_nonexcl_queues`) that is switched off, that the broker closes the connection of a client
  that declares one, and that the simulator has no exclusive queues, so every queue has to be durable. Its `refusal` is the
  broker's reply, `541` with the recorded text, kept apart so that an editor can quote it after the sentence, for a learner
  who will meet that text in a log and wants to find it. A screen shows the message first and the reply second, and never
  the reply alone.
- The name is checked first, then the flag, then whether the name is taken: `amq.x` and an empty name are refused for their
  names, and a queue that is taken and not durable is refused for the flag. No fixture has a queue with two of these faults,
  so which a broker reports first is not known, and that order is the simulator's.
- There is no `exclusive` flag in M1. When one arrives, with the connection it belongs to (OPEN_QUESTIONS 2, and the M3
  lifecycle), a queue that is not durable is valid if it is exclusive, and a new ADR supersedes this rule.
- **How it is tested.** The scenario is checked at every layer that can reach it:
  - the domain refuses the declaration, the `set`, the typed `declare queue jobs durable=false` and a document that has such a
    queue, and each gives the same code and text, and leaves the canvas as it was;
  - the replay of the recorded routing fixtures plays `routing/a-queue-that-is-neither-durable-nor-exclusive-is-refused`
    through the commands and compares the reply with the broker's, character for character;
  - S4 and S5 own the editor's part: a component test and an E2E test turn the toggle of a queue off in the inspector and
    check that the learner sees the sentence about the root cause first, then the broker's reply, and that the queue stays
    durable.

## Consequences

### Positive

- A learner who turns the toggle off is told why, in words, and sees the text that a real broker would log. Nothing that
  the simulator exports, shares or saves can be a queue that the broker refuses.
- The model needs no exclusive flag and no connection in M1.
- The one document that can hold a queue that is not durable is one that arrived from outside, and validation catches it.

### Negative / trade-offs

- A toggle that cannot stay off is a strange control. The editor has to present it as an explanation, and not as a broken
  switch. That is S4's and S5's work, and this ADR says only what the domain returns.
- `durable` can only be `true` on a queue until an exclusive flag exists, so the field carries no information for now. It
  stays, so that the saved schema does not change when exclusive queues arrive.
- The sentence states the broker's rule in the simulator's words, and the reply is the broker's. If a later release changes
  the rule, the Nightly run fails on the recording, and a person updates both.
- Not known: whether 4.3 also refuses such a queue when it arrives in a `definitions.json`. Nothing has tested it, and the
  simulator's own export cannot contain one. An importer of someone else's file has to refuse it in the same way, and S10's
  Nightly import is where it would show.

## Alternatives considered

- **Every queue durable, the toggle shown and fixed.** Rejected: a switch that cannot be turned says less than one that is
  turned and answered, and a learner would not see the refusal.
- **An `exclusive` flag in M1.** Rejected: an exclusive queue goes with its connection, M1 has no connections
  (OPEN_QUESTIONS 2), and the lifecycle that gives the flag its meaning arrives in M3.
- **Accept the queue and lint it.** Rejected in [ADR-0021](0021-transient-queues-are-refused.md): the broker does not accept it.

## Related

- [ADR-0021](0021-transient-queues-are-refused.md), and rule 28 of [ADR-0008](0008-rabbitmq-fidelity-baseline.md).
- [M1 plan](../plans/m1.md), section 2.1 and the default interpretations in section 3.
- The fixtures `routing/a-queue-that-is-neither-durable-nor-exclusive-is-refused` and
  `routing/a-queue-that-is-not-durable-is-accepted-when-it-is-exclusive` in
  [`web/fixtures/conformance/4.3/routing/`](../../web/fixtures/conformance/4.3/routing).
