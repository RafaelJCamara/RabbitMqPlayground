# ADR-0051: A declaration that repeats is idempotent, an unbind of nothing changes nothing, and a 406 names the attribute

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "What is not modelled, or not recorded" of [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md), rule 27 of [ADR-0008](0008-rabbitmq-fidelity-baseline.md) and the order of the
  checks of a queue in [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md), and answers question 8 of [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md).

## Context

ADR-0026 left two rules of the simulator where no broker had been asked: a canvas has each name once, so declaring a name that is there is refused as a duplicate, and unbinding a binding that is not there is refused as
"not bound". The scenario vocabulary could not say either step, so nothing was recorded. S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) gives the engine its `dispatch` for `exchange.declare`, `queue.declare`
and `unbind`, and has to say what each does with a name that is there. There is a broker on the machine that builds this, so the answer is read from it and not guessed.

## Decision

### What RabbitMQ 4.3.6 does, recorded

The vocabulary has a step `unbind`, and a declaration that repeats says `again: true`, which `validateScenario` demands of a repeat and refuses anywhere else. 22 scenarios were recorded on the pinned image (13 routing, 9 delivery),
and the 83 that were there came out byte for byte as they were.

| What is sent | What the broker does | Recorded as |
|---|---|---|
| An exchange declared again with every attribute the same | Accepts it, and changes nothing: the bindings stay | `declaring-an-exchange-again-with-the-same-attributes-changes-nothing` |
| ... with another type, `durable`, `auto_delete` or `internal` | `406 PRECONDITION_FAILED - inequivalent arg '<attribute>' for exchange '<name>' in vhost '/': received '<new>' but current is '<old>'`; the exchange is as it was | `...with-another-attribute-is-refused` |
| ... with several attributes different | The first of **type, durable, auto_delete, internal** | `...with-several-attributes-different-reports-the-first` |
| A queue declared again with the same attributes | Accepts it, and its messages and bindings stay | `declaring-a-queue-again-changes-nothing` |
| A queue that is there, declared again as not durable | `406` for `durable`, **not** the `541` of a new transient queue: the broker looks at what is there before it asks about the feature | `declaring-a-queue-that-is-there-as-not-durable-is-refused-as-another-attribute` |
| An unbind of a binding that is there | Takes it off, and the others stay | `unbinding-takes-a-binding-away` |
| ... of one that is not: another key, a binding already gone, two ends never bound | Accepts it, and changes nothing | `unbinding-what-is-not-bound-changes-nothing` |
| ... between two exchanges | The same | `unbinding-an-exchange-from-an-exchange` |
| ... of an exchange or a queue that is not there | Accepts it: the broker does not look for the ends | `unbinding-from-or-to-something-that-is-not-there-is-accepted` |
| ... with a topic key that a binding would refuse (`#.#.#`) | Accepts it: only a binding is checked for that | `unbinding-a-topic-key-that-no-binding-could-have-is-accepted` |
| ... from or to the default exchange | `403 ACCESS_REFUSED - operation not permitted on the default exchange`, as for `bind` | `the-default-exchange-cannot-be-unbound-from-or-to` |
| ... of a headers binding with other values, or another `x-match` | Leaves the binding. A binding that left `x-match` out is not the one that says `all` | `unbinding-a-headers-binding-needs-the-same-arguments`, `an-unbind-with-x-match-all-is-not-the-binding-that-left-x-match-out` |

Seen by hand on the same broker, and not recorded because the vocabulary cannot say them: deleting a queue or an exchange that is not there is accepted, a purge of a queue that is not there is `404`, cancelling a consumer that is not
there is accepted, and an ack of a delivery tag that was never delivered is `406 PRECONDITION_FAILED - unknown delivery tag N` and closes the channel ([ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md)).

### What the simulator does

- **A declaration of an exchange or a queue that is there is judged as the broker judges it.** The same attributes change nothing, and the command answers the very document that it was given, so nothing is saved, nothing is logged and there is nothing to undo
  (ADR-0026). Another attribute is refused with kind `inequivalent-declaration`: the message says what the exchange is and what the declaration said, that a broker does not change an exchange that it has, and which `set` does it here (`set orders type=direct`,
  which `reconcile` makes a delete and a declare, as ADR-0026 says); the broker's reply is the `refusal`, with the first attribute that differs, in the order above, and the vhost of the canvas. A queue that is there and is declared as not durable is the same refusal, with
  the flag and nothing to do but declare it as durable. The comparison is one function of `@rmq/engine` (`exchangeDifference`), used by the commands and by the engine's `dispatch`.
- **A producer and a consumer are not a broker's**, so a canvas still has each of their names once, and `add producer` of a name that is there is a `duplicate-name`.
- **An unbind is refused for the two things that were recorded and for nothing else.** The default exchange is `403` (the same check as `bind`), and a key over 255 bytes or arguments that no binding could have are refused by the client library, as they are for `bind`. A binding that is not
  there, an end that is not on the canvas and a key that a bind would refuse change nothing and answer the same document. A typed `unbind` still reads its names against the canvas, so that `unbind ordrs -> billing` is told that there is no exchange `ordrs`, with a suggestion: that is
  the grammar's help (ADR-0025) and not a refusal of the broker, and it never claims one.
- **The kind `not-bound` is gone**, since nothing makes it.
- **The engine does the same.** `exchange.declare` and `queue.declare` of a name that is there are accepted or refused as above, `unbind` takes off the binding that is exactly this one (its ends, its key and its arguments, whatever their order, with `x-match` left out not the same as `all`) and
  is accepted otherwise, and the deletes of what is not there are accepted ([ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md)). Both replays, the engine's and the domain's, play these fixtures and fail on a step that they do not know.
- **The 22 scenarios are the evidence for more than this ADR.** The nine of delivery hold the rules of ADR-0053 to the broker, and they said so: a consumer that is full leaves the turn only when it is tried, not when its prefetch is reached, which is what
  `acknowledging-does-not-change-the-order-in-which-consumers-are-served` and `a-consumer-that-was-full-comes-back-behind-the-others` show.

## Consequences

### Positive

- `declare queue billing` twice does what it does on a broker, and so does a script that declares what it needs at the top, as a real application does. A learner who changes the type of an exchange meets the broker's own `406`, and is told how to do it here.
- Question 8 is answered, and there are no claims about the broker that no fixture backs. The refusal texts are the broker's, and the spec of the replies fails if one is not a recorded text.
- A command that changes nothing is already a thing that the app handles (ADR-0026), so no screen has anything new to say: "Nothing changed, because the canvas already is as that command says."

### Negative / trade-offs

- A learner who types a name twice by mistake is no longer told that there is a duplicate. The canvas has one queue, the bar says that nothing changed, and an exchange that differs is refused with a message that says so.
- `unbind` of a typo'd name is caught by the grammar when it is typed and silently accepted when it is a command object (a template or an importer). A script that unbinds the wrong key does nothing, as it does on a broker.
- `amq.direct` and the other exchanges that a broker has are still refused here (403), where the broker accepts a declaration that says what they are. They arrive in M2.
- 22 scenarios make the Nightly verify run longer by about 25 seconds.

## Alternatives considered

- **Keep the rule that a canvas has each name once, and record the refused repeat.** Rejected: it would have recorded a refusal that the broker does not give, and the simulator would have taught that a declaration is a creation, which is what the original simulator got wrong about declarations.
- **Say in the messages that a broker accepts the repeat, with no fixture.** Rejected: ADR-0026 does not claim what nothing records.
- **Refuse an unbind of ends that are not there, as `bind` does, with the 404.** Rejected: the broker accepts it, and a refusal that carries a `404` would be false.
- **Make a repeat with other attributes change the exchange.** Rejected: no broker does, and `set` is the gesture for it.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0021](0021-transient-queues-are-refused.md), [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md), [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md).
- [ADR-0015](0015-testing-strategy-and-definition-of-done.md): a fixture is recorded, never edited to make a failure go away.
- `web/fixtures/conformance/4.3/`: the 22 new fixtures, and `web/tools/conformance/scenarios/redeclare.ts` and `delivery.ts`.
