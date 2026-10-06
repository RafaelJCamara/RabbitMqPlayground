# ADR-0041: The five ways to link share one path to one command, and a binding asks for its key first

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Five ways to link", "After a drop" and "Connection rules" of [ADR-0011](0011-explicit-linking-and-command-layer.md), and the
  keyboard linking of [ADR-0017](0017-canvas-keyboard-model.md), for what S5 ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7))
  builds on the intents and the link rules that S4 left ([ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md)).

## Context

ADR-0011 names the ways to link and says that they all end in one command layer. ADR-0017 replaced its keyboard way with the library's. The
list of issue #7 is: drag from a handle, click to connect, the "Link to…" picker, the right-click menu and `L`. S4 built the first, the second
and the last as intents (`link`, `link-invalid`, `link-to-empty`), which the `IntentHandler` turns into `linkCommand`, a binding with an empty
key. It left open what the other two are, where the key of a binding is asked for, and what the learner is told when a link cannot be made.

## Decision

### Five ways, one function

| Way | Starts | Reports | Origin of the command |
|---|---|---|---|
| Drag from a handle | the library, from the output handle of a node, with the valid targets lit | `link` via `drag` | `gesture` |
| Click to connect | the library: a click on the handle, and then on a target | `link` via `click` | `gesture` |
| "Link to…" | a button of the inspector, which opens the picker for the selected node | the choice in the picker | `inspector` |
| The context menu | its item "Link to…", which opens the same picker for the node that was pointed at | the choice in the picker | `menu` |
| `L` | the library's keyboard layer: arrow keys choose a target and Enter links | `link` via `keyboard` | `key` |

The typed `bind`, `link` and `subscribe` of the command bar are one more way in, with the origin `typed` ([ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md)).

- **All of them call `LinkFlow.request(source, target, origin)`**, in `editor/`, and nothing else makes a link. It asks the domain what the
  link is (`linkCommand`, which also says why one cannot be made), so the command that comes out is the same object whatever the way. The origin
  is the only thing that differs, and it is what the log says that the learner did ([ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md)).
- **A refusal is told in the status line and the live region, root cause first**, as every refusal is
  ([ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md)): the sentence of the rule for an invalid drop, and its own sentence for a
  drop on the default exchange ([ADR-0043](0043-the-default-exchange-is-shown-on-request-and-is-not-in-the-document.md)). Nothing else happens.
- **A `link` and a `subscribe` are applied at once.** A `bind` is applied at once from a `fanout` exchange (it ignores the key) and from a
  `headers` one (its conditions are S8's, and a binding with none matches every message, as ADR-0009 says). From a `direct` or a `topic` exchange it asks for
  the key first.

### The key is asked for before the binding exists

- **A popover opens at the target node with the cursor already in its field.** It has a visible label ("Binding key"), a sentence for the type of the exchange
  (direct: the routing key has to be this one exactly; topic: `*` is one word, `#` is any number of words, as in `order.*` and `#.created`), the
  reason under the field when a key is refused (the Issue's message first and the broker's reply after it), Enter to bind and Escape to give up. It is
  placed inside the canvas and clear of its edges, as the field that renames a node is.
- **Nothing is applied until Enter**, so the binding is one `bind` with its key: one step of undo, and an equivalent command that a learner would type
  (`bind orders -> billing key=order.*`), not a binding with no key and an edit of it. A refusal at Enter (a topic key with three `#`, a key over 255
  bytes) keeps the popover open with the reason, as the field for a name does ([ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md)).
- **Escape, and the focus leaving the popover, give up.** Nothing is made and the learner is told so ("Link cancelled."). To bind when the learner clicks
  elsewhere would make a binding that was not asked for. The focus goes back to the canvas.
- **An empty key is a key.** Enter on an empty field binds with `""`, which a direct exchange matches only for an empty routing key.
- **A binding that is there already is said so** ("Already bound with that key."), because `bind` of what is bound changes nothing and would be silent.

### The picker

- **It lists only the nodes that the rules allow**, the list that lights the handles (`allowedTargets`), grouped as exchanges, queues and consumers, each with its name and
  what the link would do (the `summary` of the verdict). The learner types to filter; the arrow keys, Enter and Escape work as in a combobox (the input has the focus and
  the list is its `aria-activedescendant`).
- **When nothing can be linked it says why**, with the sentence of the rule for that kind of node, and not an empty list.
- **It opens from the inspector** ("Link to…" for a node that can be linked from, "Change target…" for the link of a producer, which is a link again) **and from the context
  menu**, which closes before the picker opens. It closes on a choice, on Escape and when the focus leaves it, and the focus goes back to the canvas.
- **ADR-0011's floating toolbar is not built.** A button on a node is a tab stop inside a canvas that ADR-0017 makes one stop, and nodes are not tab stops. The inspector is
  where a keyboard and a touch reach the same buttons.

### Touch, and no need to drag

- Dragging and click to connect are the library's pointer path, which takes touch ([ADR-0016](0016-node-editor-library.md)), with handles of 24 by 24 pixels. The picker and the menu
  need no drag (WCAG 2.5.7). The end-to-end suite makes each way with a pointer and the two pointer ways with touch.

## Consequences

### Positive

- One function makes a link, so a rule or a message cannot differ between the ways, and a test of it covers all five.
- A binding with its key is one command and one step of undo, and its log line is what a learner would type.
- A learner who does not know that a way exists still finds the picker in the inspector and `L` in the hint bar.

### Negative / trade-offs

- A drop on a direct or a topic exchange does not draw the edge at once: the popover comes first, and a learner who clicks away has made nothing.
- A headers exchange binds with no condition until S8, which matches every message.
- `LinkFlow` holds one request that is waiting for its key, so a second link replaces the first, which is given up.

## Alternatives considered

- **Bind at once with an empty key, then edit it.** Rejected: two steps of undo for one gesture, and a log of a command that nobody typed.
- **Always ask for a key.** Rejected: a fanout ignores it, and a headers exchange needs conditions and not a key.
- **A floating toolbar on the node.** Rejected above.
- **The same menu for linking and for creating.** Rejected: a drop on nothing makes something that does not exist yet, which is a menu
  ([ADR-0042](0042-a-drop-on-nothing-opens-the-create-menu-and-what-it-makes-is-one-batch.md)), and a picker lists what exists.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0017](0017-canvas-keyboard-model.md), [ADR-0009](0009-headers-exchange-support.md).
- [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md).
- [M1 plan](../plans/m1.md), sections 2.3, 2.4 and 3 (S5).
