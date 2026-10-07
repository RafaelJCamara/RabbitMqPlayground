# ADR-0025: The grammar of the typed command

- **Status:** Accepted. `help` joins the registry as [ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md) says. The runtime verbs join the registry as [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md) says.
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Command bar (M1)" of [ADR-0011](0011-explicit-linking-and-command-layer.md). That ADR lists the vocabulary of
  the command bar. This one fixes how a command is written, read, completed and documented, and adds verbs to the list.

## Context

[ADR-0011](0011-explicit-linking-and-command-layer.md) says that the typed command bar is a text front-end for the command
layer, that every gesture is logged with its equivalent command, that errors suggest a fix, and that the reference is
generated from a registry. It gives a list of verbs and one-line sketches such as `bind orders -> billing key=order.*`. It
does not say what a name that has a space in it looks like, how a header value gets its type, what `->` is next to a name
with a dash, or what a learner is told when they mistype. S2 ([#4](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/4))
had to write all of it, and the grammar is a public interface: lessons and templates (S11) are scripts of these lines.

## Decision

**A command is one line, and its text is a faithful and canonical way to write a command object.**

- **Words.** A line is words, `->` and `;`. A word is text without whitespace. It may have quoted parts, written in JSON's
  string syntax (`"my queue"`, with `\"`, `\\`, `\n`, `\t` and `\uXXXX` inside), and a quoted part joins its neighbours the way a
  shell joins `a"b c"`, so any text at all can be written. `->` is an arrow wherever it is outside quotes, so `bind a->b`
  reads as `bind a -> b`. `;` ends a command.
- **What needs quotes.** A name, a key or a value is written bare when it reads back as itself, and quoted when it has a
  space, a `;`, a `"`, an `=`, a `(`, a `)` or a `->`, when it is empty (`""`, the default exchange), or when it starts like
  a qualifier. A tab or a line break is written as `\t` or `\n`, so a command is always one line.
- **Which element.** A name is read against the canvas. `queue:x`, `exchange:x`, `producer:x` and `consumer:x` say which
  when two elements of different kinds share a name, and the formatter writes the kind only where the name alone would not
  say. `canvas` in `set` is the canvas, so a queue called that is `queue:canvas`.
- **Typed values.** A header value is typed by how it is written: `"1"` is a string, `1` an integer, `1.0` a float, `true`
  and `false` booleans, and any other bare word a string. An integer has to be one that a JavaScript number holds exactly
  ([ADR-0023](0023-header-integers-are-limited-to-safe-integers.md)). A condition of a headers binding is `name=value` or
  `exists(name)`, and a header that is called like an option of the command, such as `key` or `x-match`, is written with its
  name in quotes. The headers of a producer's message are `header:name=value`.
- **A batch.** Commands joined by `;` are one `batch`, one change and one step of undo. Each is read against the canvas that
  the ones before it made, so `declare queue jobs; bind orders -> jobs key=job.#` works, and if one is refused the whole line
  is, and the error says which one, counting from 0, and where it is in the text. `undo` and `redo` are about the history
  and not the canvas, so they stand alone and cannot be part of a batch.
- **The verbs of M1.** `declare exchange`, `declare queue`, `add producer`, `add consumer`, `bind`, `unbind`, `link`,
  `unlink`, `subscribe`, `unsubscribe`, `set`, `unset`, `move`, `move label`, `rename`, `delete`, `clear`, `layout`, `undo`
  and `redo`. `unlink`, `unsubscribe`, `unset` and `move label` are additions to ADR-0011's list: a gesture that takes a link
  or a header away, or moves a label, needs an equivalent command to be logged as. The runtime verbs (`publish`, `purge`,
  `play`, `pause`, `step`, `speed`, `clear messages`, `reset counters`), `export`, `share` and `help` have slices of their own
  (S5, S6, S10), and join the same registry. `undo` and `redo` are read like the others and answered from the `History`.
  `declare queue` takes `type=classic` only, and refuses `quorum` and `stream` with "arrives in M4".
- **Canonical and reversible.** `formatCommand(command, document)` is what the equivalent-command log shows. For every
  command `parseCommand(formatCommand(command))` is that command, the text is the same when it is written again, and it
  is one line. These are properties, checked at 5,000 runs in the Nightly run.
- **One description per command.** A command is a `CommandSpec`: its name, its syntax and examples, `parse`, `format`. A
  `parse` reads with a cursor that says what it expects next, and autocomplete runs the same `parse` on the words typed so
  far with the cursor in probe mode, so it offers only what the parser would accept. `docs/commands.md` is generated from the
  same registry, and CI fails when it has drifted (`npm run docs:check`).
- **Errors.** A syntax error says where in the text it is (a range of characters) and what to do. A name that is not on the
  canvas, a command or an option that does not exist, and an enumerated value that is not allowed get "did you mean": the
  names that are a few edits away, closest first, with case ignored, or that start with what was typed. A word that starts
  several commands (`declare`, `add`) says which follow it. Where a command is read and then refused, the refusal is the
  same issue that applying the command gives ([ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md)).
- **What the text cannot say.** An `x-match` that is not one of the four modes, an integer beyond 2^53, and a raw header
  argument are not in the grammar, so the engine never meets them. Where a file may hold one, the importer of that file
  refuses it (S10, OPEN_QUESTIONS 3).
- **Changing it.** Adding a verb or an option does not need an ADR. Changing what a line means, or how a value is read,
  changes what saved templates and lessons do, so it needs a new ADR that says how old lines are read.

## Consequences

### Positive

- Any name a learner can type can be written, and a name with a space or an arrow in it is quoted the same way everywhere:
  the typed command, the log, the reference and the templates.
- The log's lines are real commands. A script of them rebuilds the canvas, which is how templates are written, and the
  round trip is tested for every command with odd names and every kind of header.
- The parser, the completer and the reference cannot disagree, because there is one description.
- A mistyped name gets the names that exist, and not only "not found".

### Negative / trade-offs

- The grammar is now an interface that other work depends on. The rules of quoting are strict: a name with an `=` must be
  quoted, and so must a header that is called `key`.
- JSON's escapes are the only escapes, and they work only inside quotes. A learner who writes `"it\'s"` is told which
  escapes there are, and a bare `\` is just a character.
- A `CommandSpec` has to be written for every verb, with its examples, which is more than a regular expression. The tests
  for each spec are long, because every refusal and every completion position is a case.
- The words of a command go in the order that its syntax shows. The options may be in any order, but they follow the names:
  `bind` takes its arrow before its options, and a learner who puts them first is told what was expected.

## Alternatives considered

- **Single quotes and backslashes, as a shell has them.** Rejected: a second quoting system next to the JSON of the share
  links and the files, with escapes that differ.
- **A parser generator, or a regular expression for each command.** Rejected: completion and the reference would need a
  second description of each command, and they would drift.
- **Positional arguments, `bind orders billing order.*`.** Rejected in ADR-0011, which has `key=`: a learner reads
  `key=order.*` without knowing the order of the arguments.
- **Guessing the type of a value from the exchange.** Rejected: `"1"` against `1` is the whole lesson of
  [ADR-0009](0009-headers-exchange-support.md), and it has to be visible in what is typed.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0019](0019-undo-through-immutable-document-snapshots.md),
  [ADR-0009](0009-headers-exchange-support.md), [ADR-0023](0023-header-integers-are-limited-to-safe-integers.md).
- [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md): what the commands are and what they refuse.
- [`docs/commands.md`](../commands.md), generated from the registry.
- [M1 plan](../plans/m1.md), sections 2.3 and 3 (S2, S5, S11).
