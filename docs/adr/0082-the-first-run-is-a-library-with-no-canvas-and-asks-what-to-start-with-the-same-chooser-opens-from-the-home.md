# ADR-0082: The first run is a library with no canvas, and asks what to start with; the same chooser opens from the home

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0003](0003-roadmap-and-milestones.md) ("Onboarding: start from a template, build from scratch, or take a 60-second tour"),
  [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md) (the first run makes a blank canvas) and
  [ADR-0081](0081-the-templates-are-six-scripts-of-the-command-language-in-the-domain-and-each-opens-as-a-canvas-of-its-own.md) (the templates),
  for what S11 ([#13](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/13)) puts behind `onboarding`.

## Context

Today the first thing a learner meets is an empty canvas, made for them by the library when it finds none (ADR-0072). ADR-0003 wants them asked instead: start from a template, build from scratch, or take the tour. That raises four questions: what a first run is, what the question looks like and what a refusal of it
means, where else a learner can ask for a template later, and where the code lives given that the folders of the app run one way (ADR-0057, ADR-0061, ADR-0078).

## Decision

### The flag, and what it needs

- **`onboarding` needs `editor` and `canvases`**: a template opens as a new canvas, and a canvas is something the workspace has. Without them the flag does nothing. **The tour also needs `simulation`** (its last steps send a message), so the chooser offers the tour only when the simulation is on.

### What a first run is

- **A first run is a library that has no canvas when it starts.** Nothing is stored to say that the chooser was seen. A learner who leaves it gets a blank canvas, so there is one next time and the chooser does not come back; a learner who deletes every canvas (ADR-0074) and reloads is asked again, which is right, because there is nothing to open.
  A browser that keeps nothing (ADR-0028) asks on every visit, which is right too: nothing was kept.
  A page that is opened with a link (ADR-0078) is not the workspace and never asks: it is a shared canvas and not a start.

### The chooser

- **It is a modal dialog**, in the way of the others (ADR-0072, ADR-0078): named, with the cursor in it and given back to what had it, one at a time. It says in a sentence what the playground is, and offers, in this order: the **six templates**, each a button with its name and what it shows;
  **Build from scratch**; and **Take the tour** (about a minute; only with the simulation). It is the same dialog whenever it is asked for; only its title and what leaving it means differ.
- **At the first run, leaving it makes a blank canvas.** Escape, the backdrop and the close button all mean "build from scratch": the chooser never leaves a learner without a canvas to build on, which is what they had before the flag. **From the home, leaving it makes nothing**: they asked for a template, and changed their mind.
- **It shows over the empty home**, before any canvas is made, so that choosing a template makes one canvas and not two (a blank one that has to be taken away). The library sets the home as the view, and `ready`, and waits for the answer.

### Where a learner can ask again

- **The home has a button, “New from a template…”**, beside “New canvas”, which opens the chooser. That is where the templates are after the first run, and where the tour can be taken again. The strip of open canvases is not given a button: it is crowded already, and “My canvases” is one press away.
  The editor does not offer it either: a canvas that has work on it is not where a learner chooses a start, and a new canvas from the editor is one press of the strip.

### What a choice makes

- **A template** makes a canvas named after it (“Hello World”, or the first of “Hello World 2” and so on that nobody has) from its commands (ADR-0081), by the way a canvas is made from a document (`create({ name, document })`), and opens it. A **notice** then says what to try, from the template (“Opened “Hello World”. Select the producer and press P…”).
- **Build from scratch** makes the blank canvas that “New canvas” makes.
- **The tour** makes a blank canvas called “My first topology” and starts the tour on it (ADR-0083).
- **One door**: `CanvasLibrary.begin(choice)` does all three, for the first run and for the home. The first run keeps what it had: a browser that refuses the first canvas falls back to memory, and says so.

### Where it lives

- **A folder of its own, `onboarding/`**, at the level of `share/`: above `explain/`, below `editor/` and `canvases/`. The chooser and its dialog service are there; the library and the home (in `canvases/`, above it) open it, and the editor (above it) hosts the tour. `core/`, `canvas/`, `command-bar/`, `simulation/`, `explain/` and `share/` may not import it,
  and it may not import `editor/` or `share/`, which the linter holds, with a spec for each (ADR-0078).

## Consequences

### Positive

- A learner is asked what they want before anything is made, and the usual answer is one click. Nothing about a canvas that exists changes.
- No marker to store, to lose or to explain, and a learner who has a canvas never sees the chooser unless they ask.
- The same dialog serves the first run and the home, so there is one thing to test and one thing to learn.

### Negative / trade-offs

- A learner who built something, and then deleted every canvas, is asked again. They can leave it with Escape.
- A browser that keeps nothing asks on every visit.
- The chooser is not on the strip or in the editor; a learner who wants a template while they are working goes to the home first.
