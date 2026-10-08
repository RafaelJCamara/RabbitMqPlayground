# ADR-0083: The tour is six steps in the editor that the learner does and the document ticks off, by whichever way of linking

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0003](0003-roadmap-and-milestones.md) ("a 60-second tour (which covers linking)"; the plan's timebox: the tour is built last and is the first item to move to M2, which needs an ADR that supersedes ADR-0003),
  [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md) (the five ways to link share one path),
  [ADR-0047](0047-guidance-the-hint-bar-the-how-to-link-card-and-the-cheat-sheet.md) (the card of the first run) and
  [ADR-0082](0082-the-first-run-is-a-library-with-no-canvas-and-asks-what-to-start-with-the-same-chooser-opens-from-the-home.md) (where it is asked for),
  for what S11 ([#13](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/13)) puts behind `onboarding`.

## Context

The issue asks for a tour of six steps or fewer with a linking step that accepts any of the five ways to link. A tour that explains is read once and forgotten, and a tour that points at things with a mask over the page keeps a learner from the thing they came to do and has to be built for a keyboard and a screen reader
as carefully as the page it covers. What the learner needs is to be told what to do next, and to be told when they have done it.

## Decision

### The tour is taken on a canvas of its own, and does not cover it

- **It is taken on a new blank canvas**, “My first topology”, which the chooser makes when it is asked for (ADR-0082), and nowhere else: not in a shared canvas (which has no chooser), and not on a canvas that has work on it. The tour is a **banner** in the editor under the simulation bar, a region named “Tour”, and not a mask, a dialog or a pointer to an element. It does not cover the canvas, does not take the cursor,
  does not trap the keyboard, and can be ignored. The card of the first run (“How to link”, ADR-0047) is not shown while it is there, because the tour's linking step says the same.
- **It is told in plain words that name what is on the screen**: the toolbox on the left, the dot on the right of a node, “Link to…” in the inspector, the key `L`. The words of the five ways are the ones of the card and of the cheat-sheet, from the same list.

### Six steps, and the document says when each is done

1. **Add a producer, an exchange and a queue.** Done when the canvas has one of each.
2. **Link the producer to the exchange.** The five ways are listed, and any of them does it. Done when a producer has an exchange as its target.
3. **Bind the exchange to the queue.** Same ways; a direct exchange asks for a key first (ADR-0041). Done when a binding from an exchange to a queue exists.
4. **Add a consumer and subscribe it to the queue.** Done when a consumer consumes from a queue.
5. **Send a message.** Select the producer and press P, or use its Publish. Done when a publish has been made.
6. **That is all of it.** Says what a message did (producer, exchange, queue, consumer) and where to go next: the command bar (`/`), the keys (`?`), and “New from a template…” on the home. Finish ends the tour.

- **The learner does it, and the canvas ticks it off.** A step is a question about the document or the bus, and not about which control was used. All five ways of linking end at the same command (ADR-0041), so one step accepts them all, and a way that is added later is accepted without a change. A step is as much done by the command bar as by a gesture.
- **Moving on**: a step that **becomes** done while it is the step moves the tour on, after saying so aloud (politely, with the next step's title). A step that was done when the tour came to it (after Back, or because the canvas already had what it asks for) waits to be moved on with **Next**, so that Back does not bounce. **Back** and **Next** are always there, and **End tour** too;
  a step that is not done can be skipped with Next, which is then called “Skip this step”.
- **Nothing is undone by the tour.** It reads; it never changes the canvas, the selection or the clock. Undo takes back a learner's own step and the tour follows (a step can become not done, and the tour stays where it is, which is what Back and Skip are for).

### How it ends, and what is kept

- **It ends** when the learner presses End tour or Finish, or when the editor goes (the canvas is left or closed). Nothing is stored: not that it was taken, not the step. It is not offered again by itself; it is in the chooser (ADR-0082) for whoever wants it.

### Timebox

- The plan's rule stands: the tour is the first item to move to M2 if M1 slips, by an ADR that supersedes ADR-0003. The templates and the chooser do not depend on it, which is why it is the last thing built and the only thing in the chooser that is offered conditionally.

## Consequences

### Positive

- Nothing covers the page, so there is nothing to dismiss, no focus to give back and no layer for a screen reader to be lost in.
- One predicate per step, over the document, is a pure function that a spec holds with a canvas and no browser.
- A learner who knows a way to link that the tour does not mention is not held up.

### Negative / trade-offs

- A banner points at nothing: a learner has to find “the dot on the right of a node” by its words. The first step puts the nodes on the canvas, and the words are the same as everywhere else.
- A learner who does a step in a way that does not change the document (they look at it) is not ticked off; Next moves on.
- The tour is for one blank canvas. It is not a replay over a template.
