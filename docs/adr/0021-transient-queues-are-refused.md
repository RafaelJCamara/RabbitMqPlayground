# ADR-0021: RabbitMQ 4.3 refuses transient queues, and the refusals the simulator reproduces

- **Status:** Accepted. What the `durable` flag of a queue means in the M1 model is settled by
  [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md). What a refusal closes is settled by [ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara
- **Supersedes:** rule 28 ("Deprecations") of [ADR-0008](0008-rabbitmq-fidelity-baseline.md).

## Context

Rule 28 of ADR-0008 says that transient non-exclusive queues "are deprecated in RabbitMQ 4.x. A lint warns about
them." The first record run of the conformance scenarios found that this is wrong for 4.3: the broker closed the
connection at the first such declaration ([#2](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/2)). The
runner could not say more, because a scenario had no way to expect that a step is refused, and it did not keep the
reply code.

S1 ([#3](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/3)) added that, and recorded what RabbitMQ 4.3.6
answers when it refuses something. The recordings are in
[`web/fixtures/conformance/4.3/routing/`](../../web/fixtures/conformance/4.3/routing). Every other recorded refusal
agrees with ADR-0008. The table below is what they say.

## Decision

**A queue that is neither durable nor exclusive is refused. It is not a warning.**

- The broker answers `541 INTERNAL_ERROR` and closes the **connection**, not only the channel. Its text is cut at 255
  bytes, the most that AMQP 0-9-1 allows in a reply text, and the dots at the end are the broker's:

  ```text
  INTERNAL_ERROR - Feature `transient_nonexcl_queues` is deprecated.
  By default, this feature is not permitted anymore.
  The feature will be removed from a future major RabbitMQ version, regardless of the configuration; actual version to be determined.
  To...
  ```

- Nothing is created: a later binding to that queue gets `404 NOT_FOUND`.
- A queue that is not durable is accepted when it is **exclusive**. It lives as long as the connection that declared it.
- The simulator reproduces the refusal, with the same code and text. It is an error, not a lint. Rule 28's lint is
  dropped.

**The refusals that the simulator reproduces.** The code and the text are the broker's, with the vhost written as `/`.
The engine, and the domain's validation, give these answers, and the Nightly run checks that the broker still does.

| What a client does | The broker answers | It closes | ADR-0008 |
|---|---|---|---|
| Publishes to an internal exchange | `403 ACCESS_REFUSED - cannot publish to internal exchange 'x' in vhost '/'` | the channel | rule 8 |
| Publishes to an exchange that does not exist, even if a queue has that name | `404 NOT_FOUND - no exchange 'x' in vhost '/'` | the channel | not covered |
| Declares an exchange whose name starts with `amq.` | `403 ACCESS_REFUSED - exchange name 'amq.x' contains reserved prefix 'amq.*'` | the channel | rule 9 |
| Declares a queue whose name starts with `amq.` | `403 ACCESS_REFUSED - queue name 'amq.x' contains reserved prefix 'amq.*'` | the channel | rule 9 |
| Declares the default exchange, or binds from it or to it | `403 ACCESS_REFUSED - operation not permitted on the default exchange` | the channel | rule 6 |
| Binds an exchange or a queue that does not exist | `404 NOT_FOUND - no exchange 'x' in vhost '/'`, or `no queue 'x' in vhost '/'` | the channel | not covered |
| Declares a queue that is neither durable nor exclusive | `541 INTERNAL_ERROR - Feature …` (above) | **the connection** | replaces rule 28 |

The recordings also pin four things that the table does not say:

- A refused step creates nothing, and the channel it closed does not affect the next step.
- Only the exact prefix `amq.` is reserved. `amq`, `AMQ.upper` and `amqp.x` are ordinary names, for exchanges and for
  queues.
- An internal exchange can still route: a message published to an ordinary exchange that is bound to an internal one
  reaches the queues behind it.
- Exchange names, queue names and routing keys are limited to 255 **bytes** of UTF-8. A key of 127 two-byte characters
  and an `a` is 255 bytes and is accepted. One of 128 two-byte characters is 256 bytes, and no client can send it:
  AMQP writes these as a short string with a one-byte length, and amqplib refuses before anything leaves the client.
  So there is no broker answer to record, and nothing for the engine to reproduce beyond refusing the input.

## Consequences

### Positive

- A learner cannot build, without being told, something that a real 4.3 broker refuses.
- The table is checkable. S2 and S6 reproduce each row, and a change in the broker's wording fails the Nightly run
  instead of going unnoticed.

### Negative / trade-offs

- The M1 queue model has a `durable` flag and no `exclusive` flag. The plan says the flag is "stored, shown and
  exported". A queue with `durable` off is a queue that the broker refuses, so S2 has to decide what the flag means
  until an exclusive flag exists. This ADR does not decide how the editor prevents it.
- Replies carry the broker's own wording, so a patch release that rewords one makes the Nightly run fail until a person
  reviews the new recording. That is what the Nightly run is for.

## Alternatives considered

- **Keep the lint and accept the queue.** Rejected: the broker does not accept it, and the simulator exists to show what
  a real broker does ([ADR-0008](0008-rabbitmq-fidelity-baseline.md)).
- **Refuse it with a made-up message.** Rejected: the broker's text is the specification, and a learner who searches for
  it will find the real one.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md): rules 6, 8, 9 and 28.
- [ADR-0015](0015-testing-strategy-and-definition-of-done.md): a rule that a conformance run disproves is fixed in a new
  ADR.
- [M1 plan](../plans/m1.md), sections 3 (S1) and 5.
