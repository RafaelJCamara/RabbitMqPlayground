# ADR-0081: The templates are six scripts of the command language, in the domain, and each opens as a canvas of its own

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0003](0003-roadmap-and-milestones.md) ("Templates: Hello World, Work Queues, Pub/Sub, Routing, Topics and Headers routing. Each opens as a new canvas."),
  [ADR-0025](0025-the-command-grammar.md) and [ADR-0011](0011-explicit-linking-and-command-layer.md) (the command language), and
  [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md) (a canvas is made from a name and a document),
  for what S11 ([#13](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/13)) puts behind `onboarding`.

## Context

A learner who opens the playground sees an empty canvas. The fastest way to learn what a producer, an exchange and a queue do is to see a working one, and the six that RabbitMQ's own tutorials teach are what ADR-0003 asks for. The plan adds one condition: they are written as **command scripts**, so that
the guided lessons of M5 can run the same lines. What is left to settle is where they live, how a script becomes a canvas, what the six are, and what proves that each is right.

## Decision

### A template is a script, and the commands build it

- **A template is data in the domain** (`projects/domain/src/lib/templates/`): `{ id, name, summary, tryThis, script }`. The name is on its card and is the name of the canvas it makes. The summary says what it shows, in a sentence. `tryThis` says what to do once it is open (it is shown in a notice, ADR-0082).
  The script is the commands, one to a line, in the form that the log of equivalent commands writes them.
- **It is built by the parser and the commands, and not stored as a document.** `buildTemplate` reads each line with `parseCommand`, against the canvas that the lines before it made, and applies it with `applyCommand`, with ids that count up for each kind (`x1`, `q1`, `p1`, `c1`, `b1`), so one template is the same canvas every time.
  A line that is not read, is not a command that changes the canvas, or is refused is a mistake in the template and not in whoever asked for it: it **throws**, saying which template, which line and why, as the simulation does when the engine refuses what `reconcile` gave it (ADR-0054). The specs build every template, so none ships that does.
  A stored document would have been a second source of truth that a change to a command could silently leave behind; a script cannot say what a canvas cannot hold, and a change to the grammar that breaks one fails a spec of the domain.
- **The lines are canonical**: each is what `formatCommand` writes for what it parses to. A script is then also what the log would show for the same gestures, and the lessons of M5 can show it to a learner as what to type.

### The six

They follow the tutorials, put on a canvas. Each names what it is about, and none sends a message by itself: a producer publishes once when it is told to (P, or Publish), and none repeats, because a canvas that moves before the learner has looked at it teaches nothing. Each ends with `layout`, so the nodes run left to right in the way that a message travels.

| Template | Canvas | What it shows |
|---|---|---|
| **Hello World** | producer `sender` → queue `hello` (by the default exchange) → consumer `receiver` | the smallest thing that sends a message |
| **Work Queues** | producer `dispatcher` (six tasks at a time) → queue `tasks` → consumers `slow-worker` (1,500 ms) and `fast-worker` (500 ms), manual acknowledgement, prefetch 1 | tasks shared among consumers that take one at a time: the faster one takes more |
| **Pub/Sub** | producer `emitter` → fanout exchange `logs` → queues `to-file` and `to-screen` → consumers `file-logger` and `screen-logger` | a copy of the message in every bound queue |
| **Routing** | producers `app-errors` (key `error`) and `app-info` (key `info`) → direct exchange `direct_logs` → queue `errors` (bound `error`) and queue `everything` (bound `info`, `warning`, `error`) → consumers `pager` and `archiver` | an exact key, and a queue bound with several |
| **Topics** | producer `zoo` (key `quick.orange.rabbit`) → topic exchange `topic_logs` → queue `orange` (`*.orange.*`) and queue `rabbits` (`*.*.rabbit`, `lazy.#`) → consumers `orange-watcher` and `rabbit-watcher` | patterns of words, with `*` and `#` |
| **Headers routing** | producer `scanner` (headers `format=pdf`, `type=report`, `urgent=true`) → headers exchange `documents` → queue `pdf-reports` (`x-match=all`: `format=pdf`, `type=report`) and queue `flagged` (`x-match=any`: `urgent=true`, `signed=true`) → consumers `reader` and `clerk` | all of the conditions, or any one of them, against the headers of a message |

The names are the ones of the tutorials where there is one (`logs`, `direct_logs`, `topic_logs`), and plain words where there is not. A name has no space in it, so a script needs no quotes but the one of a payload.

### What proves them

- **Each builds**, and has the exchanges, queues, producers, consumers and bindings above, no more and no fewer.
- **Each routes as it teaches**, by the engine of the app (`engineFor`): the producers publish, the clock settles, and the queues that were enqueued to and the consumers that were given a message are the ones in the table; the Topics key and the Headers message are changed once each, to the case that matches one queue and the case that matches none.
- **Each line is canonical**, and **the same template makes the same document twice**.
- **The browser plays each one** (ADR-0082): it is opened from the chooser, a producer is told to publish, and the queues it fills are the ones above.

## Consequences

### Positive

- The lessons of M5 can run these lines, and a learner who sees a template in the command log learns the language by seeing it.
- A change to the command language that breaks a template fails a spec of the domain, and not a learner.
- Adding a template is adding data and its expectation; nothing else changes.

### Negative / trade-offs

- A change to the grammar means a change to the scripts that it breaks. That is the point of building them with it, but it is work.
- The six are in English, with the text of the cards in the domain. A translation would need them moved out; the product has no other language.
- The tutorials of RabbitMQ also have RPC, and the later milestones add templates of their own (ADR-0003: alternate exchange, dead-letter loop, confirms, crash and redelivery in M3; RPC, priorities and others in M4). They arrive with the features they teach.
