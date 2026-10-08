# ADR-0079: The export is a definitions file for one vhost, written with floats as `1.0`; it lists what it leaves out, and the Nightly imports it

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0014](0014-broker-interop-via-definitions-json.md) ("Export (M1)"), the headers rules of [ADR-0009](0009-headers-exchange-support.md) (typed values, `exists`), the refusal of transient queues of [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md), the conformance run of
  [ADR-0015](0015-testing-strategy-and-definition-of-done.md), and the plan ("`definitions.json` export: floats are written as `1.0`; bindings with *exists* conditions are skipped and listed; simulator-only elements and server-named queues are listed"), for what S10
  ([#12](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/12)) puts behind `share`.

## Context

ADR-0014 settles that the app talks to a real broker only through the definitions file of RabbitMQ: a file for a chosen vhost with the exchanges, the queues and the bindings, that loads through the management UI or `rabbitmqctl import_definitions`, that leaves out what is not a broker object (producers, consumers, the layout, the settings of the simulation), and that
warns about what it cannot say. What is left is the exact shape of the file, how a value that JSON cannot tell apart is written, what is a warning and what is not, where the learner asks for it and what they see before they download, and how it is kept true: a file that the app writes and a broker refuses is worse than no file.

## Decision

### The file

- **It is a definitions file with four keys**: `vhosts` (the one vhost), `exchanges`, `queues` and `bindings`. RabbitMQ imports a file that has some of the keys and none of the others (the management API answered `204` to a file of these four, to the vhost it names), and nothing else in the file is something that the app knows (users, permissions, policies, parameters), so none of them is in it, and neither is a version of the broker: the app models 4.3, and writing "4.3.0" would say which
  build a file came from.
- **An exchange** is `{ name, vhost, type, durable, auto_delete, internal, arguments: {} }` from the exchange of the canvas. **A queue** is `{ name, vhost, durable, auto_delete: false, arguments: {} }`: the queues of the app are durable (ADR-0024), are not exclusive, and no queue type is written, so the broker's own default (classic) is the one used.
  **A binding** is `{ source, vhost, destination, destination_type, routing_key, arguments }`, with `destination_type` `queue` or `exchange` as the canvas says, `routing_key` the key of the binding as the canvas has it (a headers or a fanout exchange ignores it) and `arguments` `{}` except for a binding of a headers exchange.
- **The arguments of a headers binding** are `x-match` first, when the canvas names a mode (`all`, `any`, `all-with-x`, `any-with-x`; the broker's default `all` is not written when the canvas did not name it), then one entry for each condition in the order of the canvas, with the value it has: a string, a whole number, a float, a boolean.
- **The default exchange is not in the file**: it is the broker's, and the canvas has no record for it. A producer that publishes to a queue by the default exchange is a producer, which is not in the file either.
- **The order is the order of the canvas**: exchanges, queues and bindings as their records come, so one canvas gives one file, and a golden file can be compared byte for byte.
- **The text** is JSON with two spaces of indentation and a final newline, like the other files of the app (ADR-0027), written by a small writer of its own (below) and read back by the checks of the specs.

### Floats are written with a point

JSON has one kind of number, and RabbitMQ reads `1` as a whole number and `1.0` as a float when it imports a file (seen on 4.3.6 by hand on 2026-10-08: two bindings written with `"n": 1` and `"n": 1.0` are listed by the management API as `"n":1` and `"n":1.0`), so a header whose value is the float `1` has to be written `1.0` or the broker would hold the integer, and a binding that matches only a float would match only an integer (ADR-0009). `JSON.stringify` writes `1`, so the writer
puts the point back: a float whose text has no `.`, `e` or `E` gets `.0`, and `-0` is `-0.0`. A whole number is written as it is, and so is a float that has a fraction or an exponent. The writer is the only place that numbers are turned into text.

### What it leaves out, and says so

The export **warns about anything it cannot say**, and a warning is a sentence that names the thing, root cause first. They are kinds, in this order, and the dialog lists them before the learner downloads:

1. **A binding with an `exists` condition is not in the file**, and each one is listed with its two ends: RabbitMQ rejects a header argument whose value is nothing (an import of `"k": null` is answered `400 null_not_allowed`, seen on 4.3.6 by hand on 2026-10-08), so `definitions.json` cannot say "this header is there" (ADR-0009, the note under the rows of the editor, ADR-0068). The file has the other bindings.
2. **The simulator's own elements are not in the file**: the producers and the consumers, with their links and subscriptions, are counted and named ("The producer “sender” and the consumer “worker” are not in the file: they are the simulator's, and a broker has clients instead"). The layout, the seed and the three latencies are not either, and a line says that the
   canvas file keeps them.
3. **A queue whose name the broker chose is not in the file** (`serverNamed`, which nothing in M1 makes but a file or an import can): a client cannot declare a name that starts with `amq.`, and a broker gives another. The bindings that end at it are listed as left out with it.

A canvas with nothing to warn about says so ("Everything on the canvas is in the file."). A canvas with nothing to export (no exchange, no queue and no binding) has no file to download and says why. A warning is not an error: the file is made and downloaded with the warnings beside it, and a learner who ignores them has a file that is true to what it says it holds.

### The vhost

- **The learner chooses the vhost**, and the field starts with the one the canvas has (ADR-0014: `/` unless the canvas says otherwise). A vhost is not empty and is at most 255 bytes of UTF-8; the field says what is wrong with it under itself and the download is not switched off, as the other forms of the app do (ADR-0068).
- The vhost is written to the `vhosts` list and to every `vhost` of an exchange, a queue and a binding. The choice is not kept in the canvas: it is a choice of this export.

### Where the learner asks for it

- **Export…** is a button next to **Share…** in the top bar (ADR-0078), opening a dialog with the vhost, the list of what is left out, a line that says what is in the file ("3 exchanges, 2 queues and 4 bindings."), **Download definitions** and how to import it (the management UI's "Import definitions" and `rabbitmqctl import_definitions`, ADR-0014). The file is named
  after the canvas as the canvas file is, `orders-flow.definitions.json`. It uses the downloader of ADR-0075, so a spec records the name and the text and a journey reads the real download.
- The export is of the canvas **as it is on the screen**, like a link (ADR-0077).

### How it is kept true

- **Golden files**: `fixtures/export/` holds canvases (as the commands that make them) and the files they export to, committed once and read by a person. A spec makes each canvas, exports it and compares the text with the file, byte for byte.
- **Properties**: for any canvas that commands can make and any vhost, the file is JSON of the shape above; every exchange, queue and binding of the canvas that is not left out is in it exactly once with the vhost; every binding that is left out has a warning; a float is written with a point and an integer without one.
- **The Nightly imports it into the broker.** For each recorded scenario that only declares, binds and publishes (not a refusal, not a repeat, not an unbind, not an exclusive queue), the run makes the canvas of its topology, exports it, imports it into a new vhost of the live RabbitMQ with the management API (`POST /api/definitions/{vhost}`), plays the publishes and the
  consumers of the scenario against it, and compares what each queue got with the fixture. A difference fails the job and is investigated as the other drift is (ADR-0015): either the file is wrong or the model is.

## Consequences

### Positive

- A learner can take a design from the simulator to a real broker with two clicks, and is told what stayed behind.
- The one thing that JSON hides (a float is not an integer) is kept by a writer, a property and the broker itself.
- The Nightly shows, against a real broker, that what the app exports routes as the app says.

### Negative / trade-offs

- The file has no queue type, no policies and no arguments of the queues and exchanges: the canvas has none yet (M3 brings policies). A file made now and imported into a broker whose default queue type is quorum has quorum queues.
- A binding with `exists` cannot be exported, which is a loss of a feature of the matcher in the file. It is listed, not hidden.
- The writer of the numbers is a small piece of code of ours; the alternative, a marker in the data that is replaced in the text, is worse, as it can clash with a header that has the marker in it.
- The Nightly import needs the broker's vhost API and leaves a vhost behind if a run is killed; the runner deletes the vhost it made, as the sessions of the conformance run do.

## Alternatives considered

- **Warnings as errors.** Rejected: a canvas with a producer is the usual canvas, and it would never export.
- **Writing the producers and consumers as comments or as parameters.** Rejected: a definitions file has no place for them, and a file with keys the broker does not know is a file whose import may change with the broker.
- **A header `x-match` always written.** Rejected: `all` is the default, and a file should say what the canvas says.
- **Exporting every vhost of the broker.** Rejected: a canvas has one vhost (ADR-0014).
- **Importing in the Nightly through AMQP declarations built from the export.** Rejected: it would not test the file, only the declarations.

## Related

- [ADR-0009](0009-headers-exchange-support.md), [ADR-0014](0014-broker-interop-via-definitions-json.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md), [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md),
  [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md).
- [RabbitMQ definitions](https://www.rabbitmq.com/docs/definitions).
