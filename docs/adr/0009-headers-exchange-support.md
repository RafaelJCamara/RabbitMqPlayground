# ADR-0009: Headers exchange support

- **Status:** Accepted. The rule on integers is extended by [ADR-0023](0023-header-integers-are-limited-to-safe-integers.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The original simulator never supported the **headers exchange**. The request
([#17](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/17)) was closed as "not planned", even though teams
use headers exchanges in production. Headers matching also has traps that most tutorials skip: the four `x-match`
modes, `x-` keys being ignored, comparisons that depend on the value's type, and the behaviour of a binding with no
conditions. Supporting it properly is the playground's headline feature.

## Decision

The headers exchange ships in **M1** with the following design.

### Editing

- **Exchange type** `headers`, with its own colour and badge.
- **Binding editor** for both exchange→queue and exchange→exchange bindings:
  - An `x-match` segmented control: **all** (the default), **any**, **all-with-x**, **any-with-x** (since RabbitMQ
    3.10). No other values are allowed. A real broker rejects anything else, and the importer reports it.
  - Rows of conditions: **key**, then **type**, then **value**.
    - The type is one of `string`, `integer`, `float`, `boolean` or `exists`.
    - It is inferred from what is typed (`"1"` gives a string, `1` an integer, `1.0` a float) and can be overridden.
  - Duplicate keys are flagged. `x-` keys are flagged as "ignored unless x-match is \*-with-x".
- **Bindings built from data.**
  - "Create binding from this message": tick headers on a real message to turn them into conditions.
  - A small live table shows recent messages against each condition, ✓ or ✗.
- **Canvas label.** A compact chip, such as `all · format=pdf · type=report`, with "+N more" when needed. The full list
  shows on hover.
- **Typed command.** `bind docs -> pdf-queue x-match=all format=pdf type=report`
  ([ADR-0011](0011-explicit-linking-and-command-layer.md)). Values are inferred the same way as in the editor. The
  command reference defines the exact grammar, including how to write an *exists* condition.
- **Producer.**
  - The message composer has a typed **headers table**.
  - When the target is a headers exchange, the routing-key field shows "Not used by this exchange; still carried for
    exchange-to-exchange hops and dead-lettering". The field is **not** greyed out, because the key still matters
    downstream.

### Matching (normative; mirrors `rabbit_exchange_type_headers.erl`)

| Mode | Matches when | Which binding arguments count |
|---|---|---|
| `all` (default) | **every** counted argument matches | every argument except those starting with `x-` |
| `any` | **at least one** counted argument matches | every argument except those starting with `x-` |
| `all-with-x` | every counted argument matches | every argument except `x-match` itself |
| `any-with-x` | at least one counted argument matches | every argument except `x-match` itself |

- **An argument matches** when the message has the same key with an equal **decoded** value.
  - Integers of any width are equal to each other.
  - An integer never equals a float (`1` ≠ `1.0`).
  - A string never equals a number (`"1"` ≠ `1`).
  - The engine stores **typed values**, because JavaScript can't tell `1` from `1.0`.
- **An *exists* (void) argument** matches whenever the key is present, whatever its value.
- **When no arguments count:** `all` matches **every** message and `any` matches **none**.
  For example, an `all` binding whose only argument is `x-foo` matches everything.
- **The routing key is ignored** by the headers exchange itself.

### Explanation and interop

- **Explanation.** The route overlay and message inspector show each condition of each binding as ✓ or ✗, with a
  reason: *missing*, *value differs* or *type differs* ([ADR-0010](0010-explanation-first-editor-ux.md)).
- **Export caveat.** An *exists* condition can't be written to `definitions.json`, because RabbitMQ rejects a JSON
  `null` as an argument value. The export warns about it and lists the affected bindings
  ([ADR-0014](0014-broker-interop-via-definitions-json.md)).
- **Starter template.** "Document routing with headers": format and type headers, with `any` and `all` side by side.

## Consequences

### Positive

- It closes the original's most notable gap, with the right semantics.
- Learners see the subtle rules (types, `x-` keys, empty bindings) instead of being caught out by them in production.

### Negative / trade-offs

- Typed values make the editor, the command grammar, the file format and the share-link encoding more complex.
- `exists` conditions can't round-trip through `definitions.json`.

## Alternatives considered

- **String-only header values.** Rejected: it hides type-sensitive matching, which is a common production bug.
- **Only `all` and `any`.** Rejected: the `*-with-x` modes are part of the baseline broker
  ([ADR-0008](0008-rabbitmq-fidelity-baseline.md)).
- **Greying out the routing key for headers exchanges.** Rejected: the key is still used by downstream exchanges and by
  dead-lettering.

## Related

- [rabbit_exchange_type_headers.erl](https://github.com/rabbitmq/rabbitmq-server/blob/main/deps/rabbit/src/rabbit_exchange_type_headers.erl)
- [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0011](0011-explicit-linking-and-command-layer.md),
  [ADR-0014](0014-broker-interop-via-definitions-json.md)
