# ADR-0043: The default exchange is shown on request, and it is not in the document

- **Status:** Accepted. What the canvas does not do with it (a menu, a rename, a move, a link from it or to it) is held by journeys, [ADR-0049](0049-the-reader-of-paths-knows-what-the-bezier-edge-draws-and-a-browser-holds-where-labels-are-put.md).
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Connection rules" of [ADR-0011](0011-explicit-linking-and-command-layer.md) (a producer linked to a queue is "drawn as going through the default exchange"),
  [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) (the default exchange is the broker's, so it is refused as a name and as an end of a binding) and the setting
  `showDefaultExchange` that the document has had since S2, for what S5 ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7)) draws.

## Context

Every virtual host has an exchange with no name, bound to every queue with the name of the queue as the key, and that is how a producer publishes straight to a queue. The simulator does not model
it as an element: a canvas cannot declare it, bind from it or to it, and the engine has it built in (`toTopology` leaves it out). The learner still has to see why a producer that is linked to a queue
works, and a toggle that shows the exchange and its bindings is how ADR-0011 and the plan say so. The document has had the switch for it since S2 and nothing has drawn it.

## Decision

- **The switch is the document's own setting.** A switch in the top bar ("Default exchange") applies `set canvas showDefaultExchange=true` (or `false`) with the origin `toolbar`, so that it is saved with the canvas, taken back by undo, and logged like everything else.
- **Off, a producer linked to a queue is one edge**, from the producer to the queue, dashed, with the chip "default exchange", so that it says what a link to an exchange does not need to.
- **On, the default exchange is drawn.** A node of the canvas that is not in the document, called "Default exchange", outlined with a dashed line, in the column of the exchanges and above them
  (a new node goes below the lowest of its kind, so the two never meet). From it an implicit edge goes to every queue, dashed, with the name of the queue as its chip, which is the key that the broker gives the binding.
  A producer that is linked to a queue is drawn to the default exchange and not to the queue, and its chip is the key that it publishes with. The edge keeps the key of the link (`producer>queue`), so that selecting it,
  deleting it (`unlink`) and its label are what they were.
- **It is read-only, and it can be selected.** The library's keyboard layer reaches every connection with the arrow keys whatever the app tells it to skip (tried in S5), so the implicit edges and the node have to be things
  that can be selected without trapping a key. Selecting one shows an explanation in the inspector (what the default exchange is, that RabbitMQ binds every queue to it with its own name, that it cannot be changed or
  deleted) and nothing to change. It cannot be dragged (a drag pans the canvas, as on empty canvas), has no handle that does anything (its connectors are disabled), is not offered by the picker or the create menu,
  and has no context menu. Delete, F2 and a link from it or to it say in a sentence why not, and a producer dropped on it is told to link to the queue instead.
- **Its ids cannot be an id of the document.** `~default` and `~default>q1` do not match `ID_PATTERN`, so nothing that a command makes or a file holds can be mistaken for them, and the places that go from an id to an element
  find nothing, which is how they refuse. The selection keeps these ids while the exchange is shown, and forgets them when it is not.
- **Where it is** is worked out and never kept: in the column of the exchanges, a row above the highest of them (`defaultExchangePosition`). Auto-layout does not move it, because it is not in the document, and fit includes it.
- **The engine has no part in it.** `toTopology`, `reconcile` and the validation do not see it. The routing of the default exchange is the engine's own (S1), and what this draws is the explanation.

## Consequences

### Positive

- A learner sees why a producer linked to a queue reaches it, with the key it uses, and that every queue has this binding, without a thing in the document that a broker would refuse.
- The setting, the undo, the log and the saved file need nothing new, because it is a setting that was already in the schema.
- Nothing about the exchange can be broken by a command: there is no element to rename, delete or link.

### Negative / trade-offs

- It is a node and some edges that the document does not have, so the places that read the document by id (the inspector, the selection, the menu, the intents) each have a case for them. A spec holds each.
- With the exchange shown, every queue has an edge, so a canvas of 200 queues draws 200 more edges while it is on. It is off by default.
- A drag on the node pans the canvas, which a learner may take for a node that will not move.

## Alternatives considered

- **Put the exchange in the document.** Rejected: ADR-0026 refuses the name and the bindings because the broker does, and a canvas that has it could not be exported.
- **Draw only the producer's edge through it, and no implicit edges.** Rejected: the toggle is for showing the implicit bindings, and the key of each is what a learner is meant to see.
- **Make the node and the edges impossible to select.** Rejected: the keyboard layer lands on them anyway, and a key that selects what the app then unselects traps the arrow keys.
- **Let it be dragged and keep its place in the layout.** Rejected: the layout is a record of ids, and a place for an id that is not one would not load.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md).
- [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md): the adapter that draws it.
- [M1 plan](../plans/m1.md), section 3 (S5).
