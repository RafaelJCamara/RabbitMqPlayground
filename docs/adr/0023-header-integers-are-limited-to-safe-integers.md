# ADR-0023: Header integers are limited to the safe-integer range

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara
- **Extends:** the rule on integers in [ADR-0009](0009-headers-exchange-support.md), "Integers of any width are equal to
  each other". It adds a limit on the values.

## Context

ADR-0009 says that the engine stores typed header values, and gives an integer as `{ t: 'integer', v: number }`. A
JavaScript number is a double, which holds a whole number exactly only up to 2^53 - 1 (9,007,199,254,740,991). An AMQP
integer header can be 64 bits wide.

RabbitMQ compares integers by their exact value. Checked on RabbitMQ 4.3.6 with a binding on the int64 value 2^53 + 1
(9007199254740993): a message with that value reached the queue, and messages with 2^53 and 2^53 + 2 did not.
JavaScript cannot tell those three numbers apart (`9007199254740993 === 9007199254740992` is `true`). So an engine that
stored them as numbers would route a message that the broker does not, and the learner would see a behaviour that a real
broker never has.

The recorded fixtures cannot show this: a scenario writes a number, and a JSON number has the same limit.

## Decision

**An integer header value is refused unless it is a safe integer**, a whole number from -9,007,199,254,740,991 to
9,007,199,254,740,991. The width on the wire stays irrelevant, as ADR-0009 says, so any width carries any value in that
range.

- `headerValueIssue(value)` in `@rmq/engine` says why a value is refused. Every editor, command and importer that builds
  a header value calls it: the inference of `1` as an integer, the message composer, the `bind` command and the
  `definitions.json` importer. Nothing rounds a value quietly.
- `route()` refuses a message with such a header, by throwing a `RangeError` that names the header. A topology is taken as
  valid, because its arguments were checked when they were made.
- A float has to be finite, because JSON cannot write `NaN` or infinity. That is the same function.
- A learner who needs a larger number can use a string, which compares by its characters.

## Consequences

### Positive

- The engine never gives an answer that a real broker would not. A value it cannot represent is refused with a reason.
- Nothing changes for any value that a learner is likely to type. The limit is about nine quadrillion.

### Negative / trade-offs

- A topology that a real broker accepts, with an integer header beyond the range, cannot be built. The importer reports it
  instead of rounding it (S10).
- The one place where the simulator is narrower than the broker is written down here, and not discovered by a surprise.

## Alternatives considered

- **`bigint` values, or a decimal string for the large ones.** Rejected for M1: JSON cannot write a `bigint`, a value that
  is sometimes a number and sometimes a string complicates every consumer (the editor, the share codec, the file format),
  and nobody has asked for a header above 2^53 in a learning tool.
- **Round it to the nearest double.** Rejected: it changes what routes without telling anyone.

## Related

- [ADR-0009](0009-headers-exchange-support.md), [ADR-0008](0008-rabbitmq-fidelity-baseline.md).
- [M1 plan](../plans/m1.md), section 2.1 (header types).
