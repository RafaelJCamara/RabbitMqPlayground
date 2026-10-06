# ADR-0029: The commands refuse at the size caps, so that a canvas that commands made always loads

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Size caps" of [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md), and the
  sentence of [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) that a document that a command made
  always loads again. It answers OPEN_QUESTIONS 9.

## Context

[ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md) gave `loadCanvas` caps on what a
document may hold: 2,000 elements, 5,000 edges, 100 header entries on one message or binding, and 10,000 characters in a
payload or in a header value that is text. The repository refuses to save a canvas that is over one, so that nothing is kept
that cannot be read back. The commands did not know the numbers. A `declare` or a `bind` that took a canvas over a cap was
accepted, and the autosave then failed with an error that said what was too big. Nobody builds 2,000 elements by hand, and the
plan runs 200, but the command bar runs a batch of any size, and the autosave is a worse place to find out than the gesture that
took the canvas over the line. It also made a sentence of ADR-0026 true only in practice. S4
([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) is the slice that builds the gestures that add things, so
it is the slice that decides.

## Decision

**The numbers are the domain's, and the commands that add something refuse at them.**

- `LIMITS` of `@rmq/domain` has `elements` (2,000), `edges` (5,000), `headerEntries` (100) and `textLength` (10,000).
  `SIZE_CAPS` of `@rmq/persistence` takes these four from there, and keeps its own that are about files and names: the text of a
  file, the canvases in a backup and the name of a canvas. A spec requires the two to agree.
- What refuses, and when:

  | Command | Refused when | `kind` |
  |---|---|---|
  | `declare exchange`, `declare queue`, `add producer`, `add consumer` | the canvas has 2,000 elements already | `canvas-full` |
  | `bind` | the binding is new and the canvas has 5,000 edges already | `canvas-full` |
  | `bind` | it has more than 100 arguments, or an argument that is text is over 10,000 characters | `header` |
  | `link` | the producer has no target yet, so that the link is its first edge, and the canvas has 5,000 edges already | `canvas-full` |
  | `subscribe` | the subscription is new and the canvas has 5,000 edges already | `canvas-full` |
  | `set` of a producer | the payload is over 10,000 characters, or the message would have more than 100 headers once these are merged in, or a header that is text is over 10,000 characters | `invalid-value`, `header` |

  The typed `set sender header:n=…` is refused while it is read, with the same words, as every header value is.
- **A command that changes nothing still changes nothing.** Binding what is bound, linking a producer to the target it has,
  pointing a producer that has a target at another (one edge before and after), and subscribing to a queue that is there all
  return the document that they were given, on a canvas that is full as on any other.
- **The room is checked last.** A name that a broker would refuse, a queue that is not durable and a name that is taken are
  told first, because the learner can mend those, and a canvas that is full refuses everything that adds anything.
- **The message says that the canvas is full, why, and what to do**: "The canvas is full: a canvas holds at most 2,000 elements
  (exchanges, queues, producers and consumers), so that it can always be saved and opened again, and this one has 2,000. Delete
  something you no longer need to make room." It carries no reply of a broker's, because no broker has this rule: it is the
  simulator's, and the table of ADR-0026 does not change.
- **`validateDocument` says the same**, in the same words, so that a rule is made once: a document that arrives from a file or a
  link and is over a cap gets the sentence that a command would have given. `loadCanvas` still counts before it parses, because
  its caps are about untrusted data, and a count is made before anything is walked.
- Positions and labels need no check: there is one position for each element and one label for each edge, and both are kept to
  that by the validation.

## Consequences

### Positive

- "A document that a command made always loads again" is true without a footnote, and the learner is told at the gesture, and
  not by an autosave that fails a moment later.
- One place has the four numbers. The loader and the commands cannot drift apart, and a spec says so.
- The command bar, a template and a lesson are held to the same numbers as a drag.

### Negative / trade-offs

- Each command that adds something counts the elements or the edges, which is a pass over the keys of a few records. At 2,000
  elements that is microseconds.
- A learner who really needs more than 2,000 elements has to split the canvas, which S9 makes possible. The numbers are ten
  times what the plan runs, and a person chose them.
- A header that is text is limited in a message and a binding, and a payload is limited, and a learner who pastes a long
  document into a payload is told to shorten it.

## Alternatives considered

- **Keep the caps in persistence and let the autosave say it.** Rejected: the learner finds out after the fact, from a place that
  is not the gesture, and the command bar could still make a canvas that cannot be opened.
- **Check only in the editor's gestures.** Rejected: the command bar, a template, an import and a test would each need the check,
  and ADR-0011 says that one layer takes every change.
- **Raise the caps until nothing reaches them.** Rejected: a cap exists so that a hostile file cannot make the page run out of
  memory, and the numbers are what the loader can read without a wait.

## Related

- [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) and
  [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md).
- [M1 plan](../plans/m1.md), sections 2.5 and 3 (S2, S3, S4).
