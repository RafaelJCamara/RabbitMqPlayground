# ADR-0032: The editor's visual language: tokens, themes, a colour and a shape for each kind of node, and forms that explain

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Visual language and accessibility" of [ADR-0010](0010-explanation-first-editor-ux.md), and the target of WCAG 2.2 AA
  ([ADR-0017](0017-canvas-keyboard-model.md), section 5), with the choices that S4
  ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) had to make to draw the editor.

## Context

ADR-0010 says that each node type has its own colour and shape, that each exchange type has a badge, that the palette is colour-blind-safe, that
there are light, dark and system themes built on design tokens, and that the target is WCAG 2.2 AA. It does not say which colours, which
shapes, where the theme choice is kept, what a form looks like, or how the toggle of ADR-0024 is made to read as an explanation. The look of the
editor is S4's to decide within ADR-0010, and the owner sees it on the deployed site behind the flag.

## Decision

### Tokens, and one definition of each

- **Every colour is a custom property**, `--rmq-*`, defined once with `light-dark(light, dark)`. The page says
  `color-scheme: light dark`, which makes it follow the operating system, and `data-theme="light"` or `"dark"` on the root, set by
  the theme switch, makes it one or the other. Tailwind's `@theme inline` gives each a utility (`bg-surface`, `text-fg`), and templates
  never write a raw colour.
- **The tokens** are the neutrals (`surface`, `panel`, `canvas`, `fg`, `muted`, `line` for dividers that carry no meaning, `border` for
  the edge of a control), the accent (`accent`, `accent-fg`, `link`), `focus`, the three statuses (`danger`, `warning`, `success`, each with a
  background), the `edge`, and a stroke and a fill for each kind of node.
- **The theme choice is kept in the browser's storage**, in `rmq.theme`, as a preference of the person at that browser. It is not in a canvas, in
  a share link or in IndexedDB. A browser that will not keep it still works, for as long as the page is open.
- **A spec holds the colours to the contrast that WCAG asks for**: it reads the stylesheet, resolves each token in both themes, and checks the
  pairs that the editor uses (text on its backgrounds at 4.5:1, strokes, borders and the focus ring on their backgrounds at 3:1). axe checks the
  rendered page in both themes in the end-to-end suite.

### One colour and one shape for each kind of node

- **The hues are the Okabe–Ito set**, which stays apart for people with the common forms of colour blindness: blue for a producer, vermillion for an
  exchange, bluish green for a queue, reddish purple for a consumer. The light theme uses deeper versions of each, so that its stroke reaches 3:1
  against the canvas, and the dark theme uses the set as it is.
- **Colour is never the only sign.** Each kind also has its own outline and its own icon, and the name and the kind are text:
  a producer is a tab that points right, an exchange a hexagon, a queue a rounded tray, and a consumer a pill. The outline is an SVG path that is
  computed for the size that the node is drawn at, so that a border does not stretch and a focus ring follows the shape.
- **Each exchange type has a badge**: its name in small text, with a small icon of its own, in the node. The text carries the meaning.
- **A node is drawn at one size for each kind, and that size is `NODE_SIZE` of the domain** (140 or 160 by 56). The auto-layout leaves room for it
  and Foblex's own measures match what is drawn, so the guess of S2 becomes the number that the app draws. A name that is longer than the node
  is cut with an ellipsis, and the whole name is in the label that a screen reader reads and in the inspector.
- **Connection handles** are a dot of 12 px inside a box of 24 by 24 px, centred on the border of the node, so that the target is as large as WCAG 2.5.8
  asks and the dot is as small as the design wants. The input is on the left and the output on the right, and which a kind has follows the rules of
  linking: a producer only has an output, a consumer only an input.
- **Edges** are curves with an arrow, in the `edge` colour, in the accent colour when they are selected, and wide enough at their hit area to be clicked.
  Binding keys on an edge, as chips, are S5's.

### Focus and selection

- **A selected node or edge has the accent as its stroke, thicker**, so that selection is visible without any other cue. While the canvas has keyboard
  focus, the selected item also has a ring of 3 px in the focus colour, offset from the shape, which is the visible focus of ADR-0017 and has 3:1
  against the canvas and against the node. The canvas itself has an outline when it is focused.
- **Motion is short and stops on request**: nothing moves for longer than a fraction of a second, and `prefers-reduced-motion` turns the
  transitions off. It changes rendering only.

### Forms that explain

- **Every field has a visible label**, which is a `label` that is tied to it. A value that cannot be accepted is shown under the field, with
  `aria-invalid` and `aria-describedby`, in words that say why and what to do, and it is the `message` of the `Issue` that the command gave. The
  field is not left holding a value that the document does not have: it goes back to what the document says.
- **Help is text that can be opened, not a tooltip.** A small button next to a label (`aria-expanded`, `aria-controls`) shows a sentence under it. It
  works with a keyboard and a touch, does not vanish when the pointer moves, and can be read by a screen reader.
- **Position is a pair of numbers**, X and Y, which is how a node is moved without dragging (WCAG 2.5.7).
- **The durable toggle of a queue reads as an explanation** ([ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md)).
  It is a switch that is on, with a line of help beside it that says why it is on. When it is turned off, the editor applies `set queue durable=false`,
  the domain refuses it, and the switch stays on. Under it appears a block that says, in this order, the root cause (the `message` of the issue), and
  after it, set apart and labelled as what the broker answers, the reply with its code and its text. The block is tied to the switch with
  `aria-describedby`, and it goes when the selection changes or the learner changes something else. It is not a live region of its own: the
  command bus speaks every refusal once, assertively, through the live region of the canvas, with the sentence first and the reply after
  it ([ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md)), and a second live region would read it twice.
- **A refusal anywhere else** (a drop that links what cannot be linked, a name that is taken) is shown the same way: in the status line, with the
  message first and the reply after it, and spoken by the bus in the same way.
- **Type is the system font stack, at 14 px or larger**, and text is never set in a size that the page cannot be zoomed past (WCAG 1.4.4).

## Consequences

### Positive

- One definition of each colour, in both themes, cannot drift between them, and a spec fails when a colour no longer has the contrast that the target needs.
- A learner who cannot tell two hues apart still tells a queue from an exchange by its outline, its icon and its name.
- The toggle that cannot stay off teaches the rule instead of looking broken, and it is tested as an explanation: the sentence is there, in order.

### Negative / trade-offs

- `light-dark()` needs a browser from 2024 or later (Chrome 123, Firefox 120, Safari 17.5). The app targets current browsers, and in one that does not
  have the function the tokens are invalid and the page is drawn in the browser's own colours. A fallback cannot be written for a custom property
  that holds the function, and it is not worth a second definition of every colour for browsers that M1 does not target.
- Five shapes and a set of icons are drawn by hand, and each one is a path that has to look right at 140 and 160 px, so there is more to look after than boxes with a coloured edge.
- A node that has a fixed size cuts long names, and a learner who gives a queue a very long name sees an ellipsis on the canvas.
- Help that opens takes a click more than a tooltip that shows on hover.

## Alternatives considered

- **Define the tokens three times, as the stylesheet did** (the light values, the dark values for the operating system, the dark values for the
  switch). Rejected: with forty colours the three copies drift, and `light-dark()` makes one.
- **A palette from a component library.** Rejected: ADR-0005 keeps the design our own, and the Okabe–Ito set is the standard that is built for this.
- **Colour only, with the shapes all the same.** Rejected by ADR-0010: shapes back up the colours.
- **Tooltips for help.** Rejected: they cannot be reached from a keyboard or a touch screen without extra work, and WCAG 1.4.13 asks that they stay until dismissed.
- **Put the theme in a canvas or in IndexedDB.** Rejected: it is a preference of the browser and not of a document, and an export or a share link must
  not carry it.
- **Let the durable switch turn off and show a lint.** Rejected in ADR-0024: the broker does not accept such a queue.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0017](0017-canvas-keyboard-model.md),
  [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md), [ADR-0005](0005-frontend-angular.md).
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and the [Okabe–Ito palette](https://jfly.uni-koeln.de/color/).
- [M1 plan](../plans/m1.md), sections 3 (S4) and 6 (accessibility).
