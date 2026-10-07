# ADR-0068: A row says what is wrong under itself, a duplicate stops the commit, an `x-` key is told by what the mode does with it, and a lint stays a lint

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Editing" of [ADR-0009](0009-headers-exchange-support.md) ("duplicate keys are flagged; `x-` keys are flagged as ignored unless `x-match` is `*-with-x`"; *exists*), the lints of
  [ADR-0010](0010-explanation-first-editor-ux.md) and [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), and the sentences of
  [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md), for the rows of the editor of S8 ([#10](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/10)).

## Context

A row of the editor can be wrong in ways that a broker or the grammar refuses (no name, a name twice, a value that is out of range), and in ways that both accept and that a learner probably did not mean (an `x-` argument under `all`, which the broker
ignores). The first has to stop a commit and say why, and the second has to be said and nothing more. The domain already has the words for the first in its checks, and for the second in `headers-words.ts`, which is what the message inspector
says and what 90 golden files hold; a second wording in the editor would drift from both.

## Decision

### Problems and notes

A row has **problems**, which say that it cannot be a condition and which stop the commit, and **notes**, which say that it is one and what will surprise. A problem is under the row, in the words of the check that makes it, root cause first, and marks the
control it is about with `aria-invalid="true"` and `aria-describedby`. A note is under the row too and marks nothing. A row that is empty has neither: it is left out when the draft is committed.

| About | Problem | Words |
|---|---|---|
| A value or *exists*, and no name | A header needs a name. | `headerKeyIssue` |
| A name over 255 bytes | the name is at most 255 bytes of UTF-8 | `headerKeyIssue` |
| The name `x-match` | `x-match` is the mode of a headers binding and not a condition: choose it with the control | the sentence of `bindingHeadersIssue`, with the advice for a control |
| A name that another row has | The header 'format' is there twice. A table of headers has each name once, so give it one value. | `entriesIssue`, shown on **every** row that has the name |
| A name and no value, not *exists* | A header needs a value: an integer, such as 7 | ADR-0067 |
| A value that cannot be read, or is out of range, or is too long | ADR-0067 | `readValue` |
| More than 100 conditions | The arguments of one binding are at most 100, and there are 101. Take some off. | `tooManyEntriesIssue`, once, under the rows |

| About | Note | Words |
|---|---|---|
| A name that starts with `x-`, under `all` or `any` | The header x-foo is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x. | the line for an ignored condition in `headers-words.ts` |
| A name that starts with `x-`, under `all-with-x` or `any-with-x` | The header x-foo is counted, because x-match is all-with-x. | `headers-words.ts`, beside it |
| A name that starts or ends with a space | The name of this header starts or ends with a space, which is part of the name. | the draft |

- **The note about `x-` follows the mode.** The rows are worked out from the draft, so changing the control from `all` to `all-with-x` changes the note of the row, at once. The test is "starts with `x-`", in lower case, as the broker's is: `X-foo` is a header like any other.
- **The words are never written twice.** The checks of the domain (`headerKeyIssue`, the one for a duplicate, the reserved name, `tooManyEntriesIssue`, `readValue`) are called by the editor and by the commands, and the two sentences about `x-`
  are `headers-words.ts`'s, which also says the line of a condition in the message inspector and in the live table. The one place where the editor words something is the advice for `x-match` (a control, where a command says `x-match=any`).
  A change of a sentence there changes the files in `fixtures/explain/`; they are regenerated in the commit that changes it and their diff is read (ADR-0060).

### A duplicate stops the commit

- **"Bind" and "Apply" refuse a draft that has a problem, and are never disabled.** A button that is switched off says nothing about why, and a keyboard or a screen reader reaches it and gets nothing. Pressing it, or Enter in a field, says the first problem (under
  the editor and aloud), and gives the focus to the first control that has one. The command would refuse the same draft (`bindingHeadersIssue`), so the editor stops it where the learner can see which rows.
- **A duplicate is a problem and not a rewrite.** The editor does not choose which of the two values a learner meant.

### `x-` is a note, because a broker accepts it

A binding with an `x-` argument is valid, and what it does depends on the mode (ADR-0009): it is ignored by `all` and `any`, and counted by `all-with-x` and `any-with-x`. So it is not refused. It is said in the row, where it is typed; in the chip of the edge,
which writes `(ignored)` after the condition (ADR-0070); and in the explanation of a route, which already says it (ADR-0060). A learner who meant it to count sees the sentence and the control, which is the lesson.

### *exists*

- **It is chosen with the type** and is the fifth choice (ADR-0009: "string, integer, float, boolean or *exists*"). Choosing it takes the value field away and keeps its text, so that choosing a type again gives it back; the row has a name and nothing else.
- **It is written `exists(name)`**, in the line under the editor, in the log and in the chip, as the grammar writes it (ADR-0025). A name that needs quotes is quoted inside: `exists("my header")`.
- **The editor says once that it cannot be exported.** Under the rows, when any row is *exists*: "A condition that only asks for the header to be there cannot be written to definitions.json, because RabbitMQ rejects a JSON null as an argument value.
  The export will leave this binding out and list it" (ADR-0009, ADR-0014; the export is S10's). The producer's table has no *exists*: a message header has a value.

### Lints

- **`lint()` has the two lints it has.** S8 adds none. ADR-0010 puts more in M2, and the case a learner would meet next, an `all` binding that has nothing that counts, matches every message by the broker's own rule (ADR-0009), and it is what a binding is until its
  conditions are typed. It is said as a sentence in the editor ("No condition counts, so it matches every message"), where the learner is deciding, and not as a warning on the canvas for what a broker is built to do.
- **The `x-match=any` lint is said where the conditions are typed.** The issue asks for it; it has been on the label and in the inspector since S5. The function that words it is shared (`headersLint`), so the editor shows the same sentence under the rows, as
  "Worth a look", as the draft changes, before the binding exists, and the badge stays on the edge afterwards. A lint never stops a command and never changes a document: "Bind" and "Apply" are not held back by it.
- **The sentence of the draft** says what the binding asks, in the words of the mode: "x-match=all: a message matches when all 2 conditions hold (format and type).", "x-match=any: a message matches when at least one of the 3 conditions holds.",
  "x-match=all and no condition counts, so it matches every message.", and the note of how many `x-` arguments are not counted. The last two are the lines `headers-words.ts` says for a binding with nothing that counts, said from one function.

## Consequences

### Positive

- A duplicate, a missing name and a number that is too big are told under the row they are about, in the words of the command that would refuse them, and the learner learns the rule where they broke it.
- The `x-` rule is on the screen in four places, and in one set of words.
- A button that always answers is reachable and informative for a keyboard and a screen reader.

### Negative / trade-offs

- The editor and the commands share their checks, so a change of a check changes both at once. That is the point, and it means a spec of the editor cannot pin a sentence that the domain owns.
- A learner can bind a set of conditions that match every message or none, and is told, and not stopped. That is how a lint is.
- A name with a space at its end is allowed and noted, and not trimmed, because trimming would change what is stored without saying so.

## Alternatives considered

- **Disable "Bind" while a problem is there.** Rejected above.
- **Refuse `x-` names, or drop them from the draft.** Rejected: the broker accepts them, `all-with-x` counts them, and the lesson is that the same row means two things.
- **Write the sentences of the rows in the component.** Rejected: they would be a second wording of the explanation, with no golden file to hold it to the broker.
- **A lint for `all` with nothing that counts.** Rejected above; if a lesson wants it, it is a lint of M2.
- **Merge or keep the first of two rows with the same name.** Rejected: it picks a value for the learner.

## Related

- [ADR-0009](0009-headers-exchange-support.md), [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0014](0014-broker-interop-via-definitions-json.md), [ADR-0025](0025-the-command-grammar.md),
  [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md),
  [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md).
- [ADR-0066](0066-a-headers-binding-is-made-in-a-popover-and-edited-in-the-inspector-from-one-draft-and-an-edit-is-one-batch.md),
  [ADR-0067](0067-a-value-is-typed-by-how-it-is-written-one-function-reads-it-for-the-editor-and-the-grammar-and-a-type-is-changed-by-rewriting-the-text.md),
  [ADR-0070](0070-a-binding-is-made-from-a-message-by-ticking-its-headers-the-live-table-is-the-explanation-of-the-draft-and-a-chip-says-the-mode-and-the-first-conditions.md).
- [M1 plan](../plans/m1.md), section 3 (S8).
