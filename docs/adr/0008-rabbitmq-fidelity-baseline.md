# ADR-0008: RabbitMQ fidelity baseline (4.3.x)

- **Status:** Accepted. Rule 28 is superseded by [ADR-0021](0021-transient-queues-are-refused.md), and rule 4 is extended
  by [ADR-0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md), and the alignment of a topic miss is settled by [ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md). Rule 27 is extended by [ADR-0051](0051-a-declaration-that-repeats-is-idempotent-an-unbind-of-nothing-changes-nothing-and-a-406-names-the-attribute.md), and rules 13 to 16 are settled by [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

"Faithful to RabbitMQ" only means something against a specific broker version, because behaviour changes between
versions:

- `x-match=any-with-x` and `all-with-x` arrived in 3.10;
- quorum queues got a default delivery limit in 4.0;
- quorum queue priorities changed in later 4.x releases.

Textbook descriptions also miss edge cases that real brokers have, such as empty topic words and alternate-exchange
chains.

At the time of writing, the latest stable release is **RabbitMQ 4.3.6** (2026-09-14).

## Decision

### Baseline

- The simulator targets **RabbitMQ 4.3.x**.
- Every saved canvas records the baseline it was built against (`"rabbitmqBaseline": "4.3"`).
- Behaviour follows the **RabbitMQ server source** for that version. Where the docs and the source disagree, the source
  wins.
- The **conformance tests** settle it ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)). Any rule below
  that a conformance run disproves is fixed in a new ADR that supersedes this one.
- Moving to a new baseline needs a new ADR and regenerated golden fixtures.

### Normative rules

**Routing**

1. **When routing happens.** Routing is decided all at once, at publish time
   ([ADR-0007](0007-deterministic-simulation-engine.md)).
2. **Direct exchanges.** The routing key must equal the binding key exactly; the comparison is case-sensitive.
3. **Fanout exchanges.** Every bound destination gets the message; the routing key is ignored.
4. **Topic exchanges.** Keys are split into words on `.`. `*` matches exactly one word, which may be empty. `#` matches
   zero or more words.
   - `""` has zero words, so `#` matches it and `*` does not.
   - `a.#` matches `a`, and `a.#.b` matches `a.b`.
   - `a..b` is valid and has an empty middle word.
   - `*` and `#` are wildcards only when they are a whole word, so `a*` is a literal word.
   - Routing keys are limited to 255 UTF-8 bytes.
5. **Headers exchanges.** See [ADR-0009](0009-headers-exchange-support.md).
6. **Default exchange `""`.**
   - It is implicitly bound to every queue, using the queue name as the key.
   - It can't be the source or destination of an explicit binding.
   - It never uses an alternate exchange.
7. **Exchange-to-exchange bindings.** These are followed recursively. Each exchange is visited at most once per message,
   so cycles are safe. A message reaches a given queue **at most once** per publish, however many paths match.
8. **Internal exchanges.** Clients can't publish to them directly.
9. **Reserved names.** Exchange and queue names starting with `amq.` are reserved; declaring one is refused (403).
10. **Unroutable messages.** A message that reaches no queue is dropped.
11. **Alternate exchanges (AE).**
    - An exchange's AE is used only when **that exchange's own** bindings matched nothing, neither queues nor
      exchanges.
    - If X routes to Y and Y matches nothing, Y's AE is used, not X's.
    - A chain of AEs shares the same visited set, and a missing AE is skipped.
12. **`mandatory`.** The message is returned (`basic.return`, 312 NO_ROUTE) only if no queue received it after every AE
    was tried.

**Delivery**

13. **One consumer per message.** Each message in a queue goes to exactly one consumer.
14. **Dispatch.** Round-robin among the consumers that have **free prefetch capacity**, highest consumer priority first.
15. **Prefetch.** Set per consumer. `0` means unlimited, and prefetch is ignored for auto-ack consumers.
16. **Cancel vs close.** `basic.cancel` does **not** requeue unacked messages; the consumer can still ack them.
    Closing the channel or connection requeues them with `redelivered=true`.
17. **Publisher confirms.**
    - An unroutable message published as `mandatory` is returned first, then acked.
    - A publish refused by `reject-publish` overflow is nacked.

**Dead-lettering, TTL and limits**

18. **Dead-lettering triggers.**
    - reject or nack with `requeue=false`;
    - TTL expiry;
    - length overflow with `drop-head` (the oldest message) or `reject-publish-dlx` (the new message; classic queues
      only);
    - the quorum queue delivery limit.
19. **Never dead-lettered.** Plain `reject-publish` (the message is dropped), purge, queue deletion and `x-expires`.
20. **Dead-letter details.**
    - If the dead-letter exchange is missing, the message is dropped silently.
    - Dead-lettered messages are never returned to the publisher.
    - `expiration` is removed from the message, and `x-death` keeps a count per (queue, reason).
    - A dead-letter cycle is dropped only if nothing in the cycle was a rejection.
21. **TTL.**
    - TTL can be set per queue (`x-message-ttl`) or per message (`expiration`).
    - Expired messages are removed lazily, when they reach the head of the queue.
    - Unacked messages never expire, and a requeued message keeps its original expiry.
    - `expiration: "0"` means the message expires unless it can be delivered immediately.
22. **Length limits.** `x-max-length` counts **ready** messages only. `x-max-length-bytes` counts message bodies only.

**Queue types and lifecycle**

23. **Lifecycle.**
    - **Exclusive queues** are deleted when their connection closes.
    - **Auto-delete queues** are deleted when their last consumer leaves, provided they ever had one.
    - **Auto-delete exchanges** are deleted when their last binding is removed, provided they ever had one.
    - Queues with `x-expires` are deleted after being unused for that long.
    - Consumers of a deleted queue get a cancel notification.
24. **Priority.**
    - Classic queues (`x-max-priority`): a missing priority counts as 0, and anything above the maximum counts as the
      maximum.
    - Quorum queues follow the 4.3 priority model, pinned by the conformance tests.
25. **Quorum queues.**
    - `x-delivery-limit` defaults to 20, and `x-delivery-count` is tracked. Which requeue outcomes count towards the
      limit follows 4.3 and is pinned by the conformance tests.
    - Quorum queues can't be exclusive, don't support global QoS, and don't support `reject-publish-dlx`.
26. **Streams.** Reads don't remove messages. A consumer starts from an offset (`first`, `last`, `next`, a number or a
    timestamp). Retention is by size or age. Consumers must use manual ack with a prefetch.
27. **Arguments and policies.**
    - Queue arguments can't be changed after declaration; redeclaring with different arguments fails with 406.
    - Policies apply arguments by pattern. For numeric limits the lower value wins; otherwise the queue argument takes
      precedence. This is pinned by the conformance tests in M3.
28. **Deprecations.** Transient non-exclusive queues are deprecated in RabbitMQ 4.x. A lint warns about them.

## Consequences

### Positive

- There is a clear, checkable definition of "correct". Learners see what a real broker would do.
- Edge cases (topic, headers, alternate exchanges, dead-lettering) are spelled out, which drives the tests directly.

### Negative / trade-offs

- We have to follow RabbitMQ releases and supersede this ADR when the baseline moves.
- Older brokers' behaviour isn't simulated. A per-version "compatibility mode" could come later if users need it.

## Alternatives considered

- **Version-agnostic "textbook" semantics.** Rejected: it would teach behaviour that real brokers don't have.
- **Several selectable broker versions.** Deferred: the cost is high and demand is unproven.

## Related

- Sources ([rabbitmq-server](https://github.com/rabbitmq/rabbitmq-server), `deps/rabbit/src/`):
  - `rabbit_exchange.erl`: routing, alternate exchanges.
  - `rabbit_exchange_type_headers.erl`: headers matching.
  - `rabbit_db_topic_exchange.erl`: topic matching.
  - `rabbit_channel.erl`: publishing and acks.
- Releases: [rabbitmq-server releases](https://github.com/rabbitmq/rabbitmq-server/releases).
- [ADR-0009](0009-headers-exchange-support.md): headers matching rules.
