# ADR-0026: Commands name elements, ids stay in the document, and a refusal says whose rule it is

- **Status:** Accepted. The sentence that a document that a command made always loads again is made true by [ADR-0029](0029-the-commands-refuse-at-the-size-caps.md).
  The bus that applies the commands in the app is [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md).
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "One command layer" of [ADR-0011](0011-explicit-linking-and-command-layer.md) and the document model of
  [ADR-0019](0019-undo-through-immutable-document-snapshots.md), with the choices that S2 had to make to build them.

## Context

[ADR-0011](0011-explicit-linking-and-command-layer.md) says that every change is a serialisable command, validated against
the current state, and [ADR-0019](0019-undo-through-immutable-document-snapshots.md) that the document is immutable, that
`History` keeps document references, and that `reconcile(previous, next)` keeps the engine in step. The
[plan](../plans/m1.md) says that ids are stable and names are attributes. They leave open how a command refers to
something, what applying a command may depend on, what a refusal contains, what `reconcile` does and does not look at, and
which of the rules are the broker's and which are the simulator's. S2
([#4](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/4)) wrote the code, and these are the choices in it.

## Decision

### Commands

- **A command names an element by kind and name**, `{ kind: 'queue', name: 'billing' }`, and never by id. The same line has
  to mean the same thing typed by a person, written in a template or a lesson, and read back from the log of equivalent
  commands, and none of them can know an id. Ids stay inside the document, so that a rename keeps every binding, link,
  subscription and label.
- **New ids come from the caller.** `applyCommand(document, command, context)` is a function of its three arguments, and
  `context.newId(kind)` supplies the id of something new. The domain has no clock and no random numbers, so applying a command
  is the same every time, and the app chooses where ids come from. An id that the canvas already has, or that does not match
  `ID_PATTERN`, is a bug of the caller's, and `applyCommand` throws. It is not a refusal.
- **A refusal changes nothing, and a command that would change nothing returns the same document.** `bind` of a binding
  that is there, `link` to the target it has, `rename` to the same name, `move` to the same place, `set` to the same value
  and `layout` of a canvas that is in place all return the very object that they were given. So "did anything change?" is
  `===`, a `History` takes only changes, and `undo(apply(document, command))` is `document`
  ([ADR-0019](0019-undo-through-immutable-document-snapshots.md)). What a command did not touch is shared with the new
  document.
- **A batch is atomic.** Its commands are applied one after another, each to what the one before it made, and if one is
  refused the batch is refused, and the issue says which, counting from 0 (`batchIndex`). An empty batch is refused. Drag
  to create is one batch, so it is one step of undo.
- **The commands of M1:** `declare-exchange`, `declare-queue`, `add-producer`, `add-consumer`, `bind`, `unbind`, `link`,
  `unlink`, `subscribe`, `unsubscribe`, `set` (an exchange, a queue, a producer, a consumer or the canvas), `unset` (headers
  of a producer's message), `move`, `move-label`, `rename`, `delete`, `clear`, `layout` and `batch`. `undo` and `redo` are not
  commands on the document, but on the `History`. `delete` takes with an element every edge that it has, as a broker takes
  the bindings of a queue that it deletes, and undo brings all of it back.
- **Where a node goes.** A new node goes in the column of its kind, below the lowest of its kind. `layout` puts every node
  in its place with dagre (`@dagrejs/dagre`), from left to right in the way a message travels: producers, exchanges, queues,
  consumers, and a chain of exchanges takes a column for each. It looks only at what is linked, so the same canvas always
  gives the same drawing.

### Refusals

- **An `Issue` is the one shape of everything that is wrong:** a refusal of a command, a problem that the validation of a
  document finds, and a parse error. `kind` is a closed list that a program branches on. `message` says the root cause in
  plain words for someone who is learning, and what to do. `refusal` is the broker's reply, `{ code, text }`, word for word,
  and only where one was recorded against a real broker. `suggestions` are the names that were probably meant. `path` says
  where in the document, and `at` where in the typed text.
- **The message comes first and the reply after it.** The reply says what the broker did and not always why, so it never
  replaces the sentence ([ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md)).
- **A rule is made once.** A command and the validation of a document refuse the same thing, in the same words, with the same
  reply, from the same function. A document that commands made is always valid, and a document that was loaded, imported or
  shared is checked by `validateDocument` and not trusted. This is checked as a property.
- **Whose rule it is.** A refusal carries a `refusal` only if a broker said it:

  | Rule | Whose | Reply |
  |---|---|---|
  | A name that starts with `amq.` (exchange or queue) | the broker | `403`, recorded |
  | The default exchange declared, or bound from or to | the broker | `403`, recorded |
  | A binding to or from an exchange or a queue that is not there | the broker | `404`, recorded |
  | A topic binding key with three `#` words | the broker | `406`, recorded ([ADR-0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md)) |
  | A queue that is not durable | the broker | `541`, recorded ([ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md)) |
  | A producer linked to an internal exchange | the broker, at the publish | `403`, recorded |
  | A name over 255 bytes, a routing key or a binding key over 255 bytes | the client library, which refuses before anything is sent | none to record |
  | An empty name for a queue, a producer or a consumer, a name that another element of the kind has, a link that the connection rules of [ADR-0011](0011-explicit-linking-and-command-layer.md) do not allow, unbinding or unlinking or unsubscribing what is not there, a number out of its range, a header integer beyond 2^53 ([ADR-0023](0023-header-integers-are-limited-to-safe-integers.md)) | the simulator | none |

  The order in which a broker reports two faults of one binding is recorded
  (`routing/a-binding-with-two-faults-gets-one-refusal`): the default exchange, then the source, then the destination,
  then the key. The commands check in that order. For a queue declaration the order is the simulator's, because no fixture
  has two faults in one declaration ([ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md)).

### The engine

- **`reconcile(previous, next)`** returns the engine commands that turn the topology of one document into the topology of
  the other, and `null` stands for an engine with nothing in it, which is what a canvas that has just been loaded starts
  from. It compares by names, as the broker sees them, and never by ids, and it does not look at what happened between the
  two documents, so it serves do, undo, redo, load and clear alike.
  - A broker cannot rename or change an exchange or a queue ([ADR-0008](0008-rabbitmq-fidelity-baseline.md), rule 27), so a
    rename, a new type and a changed flag are a delete and a declare. A binding that goes with a deleted end is not unbound,
    because the broker removes it itself, and one that the next document keeps is bound again.
  - The order is the one in which each command is valid for the topology the ones before it made: unbind, delete, declare,
    bind. No command is given twice and none is a no-op.
  - Only the topology is in it: exchanges, queues and bindings. Producers and consumers have no engine command until the
    simulation arrives (S6), and their diff goes in beside this one. Layout, labels and settings never reach the engine.
- **The engine's command types are in `@rmq/engine`** and follow the names of the conformance steps: `exchange.declare`,
  `exchange.delete`, `queue.declare`, `queue.delete`, `bind` and `unbind`. S6 implements `dispatch` for them and adds the
  rest. The code of a refusal is `403`, `404`, `406` or `541`, so that a refusal that closes the connection fits
  (OPEN_QUESTIONS 2).
- **Until the engine can dispatch them, a small oracle in `@rmq/testing`** applies those commands to a broker's topology, and
  refuses what a broker would not do twice, a declare or a bind that is already there. The property "after any run of
  commands, undos, redos and loads, an engine fed by `reconcile` has the topology of the document" is checked against it,
  and S6 checks it against the engine itself.

### The document

- **Strict.** The schema rejects keys that it does not know. Header values and conditions are tagged with their type, since
  JSON cannot tell `1` from `1.0`, and a record lists its entries in the order they were made. The numbers have ranges
  (`LIMITS`), and a document that a command made always loads again.
- **Names are unique within a kind**, and a queue and an exchange may share a name. `canvas` is not special in a document.

### What is not modelled, or not recorded

These are rules of the simulator where a broker does something else, or where nothing was recorded. Each is a candidate for
a scenario and, if it differs, a new ADR.

- **Declaring a name that is taken.** By RabbitMQ's documentation a broker accepts a second declaration with the same
  attributes and refuses one with other attributes with `406 PRECONDITION_FAILED`. No fixture has either, because the
  scenario vocabulary has no step that declares a name twice (OPEN_QUESTIONS 8). The simulator refuses both as a duplicate
  name, with no reply of the broker's, and a learner changes an element with `set`.
- **Unbinding a binding that is not there**, which the vocabulary has no step for either. The simulator says that there is
  none, and what the bindings between the two ends are.
- **The exchanges that every broker has**, `amq.direct`, `amq.fanout`, `amq.topic`, `amq.headers`, `amq.match` and
  `amq.rabbitmq.trace`, arrive in M2 (plan, default interpretations). A binding that names one is told so, and gets no
  reply of a broker's.
- **A queue that the broker names**, `amq.gen-…`, has a field in the schema (`serverNamed`) and no command in M1: an empty
  name is refused for a queue.
- **An auto-delete exchange or queue** that a broker deletes by itself when the last binding or consumer goes. M1 stores
  the flag and does not run the lifecycle (plan, default interpretations), so `reconcile` assumes that the engine holds what
  the previous document says. When the lifecycle arrives in M3 it has to be given what the engine holds.

## Consequences

### Positive

- The same line works from the command bar, a template, a lesson, a test and the log, and a log replayed on an empty canvas
  gives the same document up to its ids.
- Undo, redo, dirty tracking and autosave all rest on `===`, and nothing can drift from the document.
- A learner is shown whose rule they hit. A reply is the broker's only where a broker said it.
- The commands, the validation and the replay of the recorded fixtures agree, because they share the rules and the replay
  checks every refusal against what the broker answered, character for character.

### Negative / trade-offs

- A command that names something is read against the document at the moment it is applied. A name that was valid when the
  line was written may not be there, or may mean two things (`queue:` and `exchange:` say which).
- The caller has to provide ids, and a generator that repeats one is a bug that throws.
- Where the simulator refuses and a broker accepts (a second declaration, an unbind of nothing), a learner who moves to a
  real broker will find it quieter. The messages do not say so, because nothing was recorded to back the claim.
- The rules of the simulator are numbers and texts that a person chose (the ranges, the column of a node, the sizes that a
  layout leaves room for), and the app may refine the sizes.

## Alternatives considered

- **Commands that carry ids.** Rejected: a typed line and a template cannot know them, and the equivalent-command log would
  show ids that a learner has never seen.
- **Ids made inside `apply`, from a counter or a random number.** Rejected: applying a command would not be the same twice,
  and the properties could not replay a script.
- **Throwing for a refused command.** Rejected: a refusal is an expected answer that a UI shows. Only a broken id generator
  throws.
- **Idempotent declarations, as a broker has them.** Not chosen yet: it needs the broker's `406` text for a declaration that
  differs, which no fixture has, and a step in the scenario vocabulary that declares a name twice.
- **Diffing the engine's own state in `reconcile`.** Rejected for M1: the engine has no topology dispatch until S6, and the
  document is the only thing that can be diffed without it.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0019](0019-undo-through-immutable-document-snapshots.md) and
  [ADR-0025](0025-the-command-grammar.md): the layer, the history and the text.
- [ADR-0021](0021-transient-queues-are-refused.md), [ADR-0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md) and
  [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md): the refusals that carry a reply.
- [ADR-0008](0008-rabbitmq-fidelity-baseline.md): rules 6, 8, 9, 27 and 28.
- [M1 plan](../plans/m1.md), sections 2.1, 2.3 and 3 (S2).
