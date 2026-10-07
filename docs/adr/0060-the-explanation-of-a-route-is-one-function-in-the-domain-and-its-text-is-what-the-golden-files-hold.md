# ADR-0060: The explanation of a route is one function, in the domain, and its text is what the golden files hold

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Explanation and interop" of [ADR-0009](0009-headers-exchange-support.md) (each condition ✓ or ✗ with a reason), "Explanation" of [ADR-0010](0010-explanation-first-editor-ux.md), "Pure query functions" of
  [ADR-0007](0007-deterministic-simulation-engine.md), the dependency table of [ADR-0018](0018-workspace-layout-and-dependency-rules.md) and the tiers of [ADR-0015](0015-testing-strategy-and-definition-of-done.md), for what S7
  ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) says about a route, and the golden files that the plan asks for ("trace rendering against golden traces from the fixtures").

## Context

The message inspector, the Why? overlay, the "why didn't it get here?" of a queue and the what-if tester say the same thing about a message and a topology, in four places. The plan wants the rendering held against the fixtures, which the broker recorded, so that
the broker and not the engine is the judge of what the learner is told. A rendering that only the Angular templates know cannot be run from a tool or held to a file, and sentences that four components each write drift apart.

## Decision

### One function, in the domain, that returns data

- **`explainRoute(topology, message)` and `explainQueue(topology, message, queue)` are in `@rmq/domain`**, in `explain/`, and return plain data that survives JSON. They read only engine types, so they are given the topology of any canvas (`toTopology(document)`), the topology that a golden file
  replays, and a message that no producer sent. The domain already says things about the canvas in words (the issues, the lints, the command reference); what the engine decided is said there too, and the engine stays free of wording and the app of rules.
- **`explainRoute` gives a tree and a verdict.** The root is the exchange that the message was published to, with every binding that starts from it (matched or not, in the order they were made), and each binding that was the first to reach an exchange has that exchange under it, with its own bindings:
  the tree is the trace read by `via`. A binding has its verdict, whether it was followed (it gave a queue its first copy, or took the message to an exchange that had not been visited), a **short reason** (at most 48 characters, for the label of an edge), a **sentence**, and a **detail** that is data:
  the comparison of a direct exchange, nothing for a fanout, the alignment of a topic key ([ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md)), the conditions of a headers binding, each with what was wanted, what was found and why it failed, or the implicit binding of the default exchange.
  For the default exchange the tree lists an implicit binding for every queue, and the one whose name is the key is the one that matched: the topology has the queues, and the trace need not carry them.
- **It also gives** the queues that were reached, in the order of the paths, and the queues that were not, in the order of the topology, and a one-sentence summary ("Reached billing and audit.", "No queue got it: it reached orders, and none of its 3 bindings matched.").
  A publish that the broker refuses has the broker's reply after the cause, as ADR-0050 says, and a message that could not be sent (a key over 255 bytes, a header that is not exact) is `invalid` with the sentence that the engine's checks give: **it never throws**, so a tester that is typed into cannot break the page.
- **`explainQueue` is for one queue**: for one that was reached, the way it went (each hop with the binding that matched); for one that was not, the reasons of `explainMiss` as a tree of sentences, each ending on a binding that was tried and what it made of the message, on an exchange that nothing leads into, on a cycle, or on an exchange explained
  elsewhere. It is computed on demand, because a canvas has as many answers as it has queues.
- **The words say the cause first, as a learner would**, and quote what was compared: "The key is order.created, and this binding wants order.deleted: a direct exchange compares the whole key, letter for letter." A sentence is written once, with its parts (the key, the pattern, the header)
  as data beside it, so that a template can mark them, and a test can read both.

### The plain text is the rendering that the golden files hold

- **`explanationText(explanation, queues)` writes the whole thing as lines of text** (a tree, with the alignment of each topic binding as two lines and each header condition as a line), deterministic, with `\n`. It is what a golden file contains and what a person can read in a diff, and a template draws the same data
  with marks and a table.
- **A tool renders the golden files** (`web/tools/explain/`, `npm run explain:generate` and `explain:check`): it replays every routing fixture through the engine's `dispatch` to get the topology that each publish saw, calls the function above for the publish and for every queue, and writes `web/fixtures/explain/4.3/<fixture>.txt`. The check fails on a file that is
  missing, extra or different, with the first line that differs, as `docs:check` does. **A golden file is never regenerated to make a failure go away**: a difference is read, and it is either a change of wording that is meant, which is regenerated in the commit that makes it and shows in its diff, or a bug.
- **A spec holds the rendering to the broker.** For each publish of each fixture, the queues that the rendering says were reached, read from its **text** and from its data, are the queues that RabbitMQ recorded, and no queue that the broker did not use is said to have been reached. That is the place where the judge is the broker.
  The engine's own replay of the fixtures already holds `route()` to the broker, and this holds what the learner reads.
- **Properties, in the libraries**: for any topology and any message, `explainRoute` does not throw, says the queues that `route()` reached, and gives each queue that it did not a reason; `explainQueue` and `route` agree on every queue; the size of every answer is bounded by the size of the topology
  (a ladder of 40 levels, [ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md)); every answer survives JSON; and the same input gives the same text. They run at 5,000 runs with several seeds before they are pushed (ADR-0015).

### What else the domain gets

- **`bindingIds(document)`**, the ids of the bindings in the order of `toTopology(document).bindings`, so that an index in a trace is a binding of the canvas, and a binding of the canvas is an edge.
- **`parseMessageText(text)`**, which reads what follows the exchange in `publish`: `key=…`, `payload=…` and `header:name=value`, with the same inference of types and the same refusals, so that the what-if tester takes the text form of the command ([ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md)) and there is one reader of it.

## Consequences

### Positive

- The inspector, the overlay, the queue's answer, the tester and the golden files cannot say different things, because one function says them, and the fixtures that the broker recorded hold the words.
- A change of wording is a diff of text files that a person reads, and a change of rule is a failing comparison with the broker.
- The explanation can be asked for any message of any canvas without the simulation: the tester works with `explain` alone.

### Negative / trade-offs

- The domain gains a folder of wording, and the golden files are 91 more files of data in the repository (about a megabyte, reviewed as data, outside Prettier like the conformance fixtures).
- Every wording change shows in many golden files. That is the cost of holding words to something, and a reason to word it well the first time.
- The tree lists an implicit binding for every queue of the default exchange, which is a long list on a big canvas. The inspector folds it, and the canvas shows only what the learner looks at.

## Alternatives considered

- **The rendering in the app, and the tool importing it by a relative path.** Rejected: the tool would reach into the application's folders, and a composite project cannot compile a file that it does not list.
- **A fifth library for explanation.** Rejected: the dependency table, the aliases, the coverage and the boundaries are a project of their own for a folder that the domain can hold.
- **Render from the trace in the event and not from the topology.** Rejected: the trace does not have the queues that were not reached, or the bindings that point at an exchange that was never visited, so it cannot answer "why not". The topology that routed the message and the message are enough, and `route()` is a function.
- **Golden files for the whole fixture in one file.** Rejected: one file for each fixture is a diff that names the scenario that changed.

## Related

- [ADR-0007](0007-deterministic-simulation-engine.md), [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0009](0009-headers-exchange-support.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0018](0018-workspace-layout-and-dependency-rules.md), [ADR-0025](0025-the-command-grammar.md).
- [ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md), [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md),
  [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md).
- [M1 plan](../plans/m1.md), sections 3 (S7) and 5.
