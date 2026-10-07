# ADR-0067: A value is typed by how it is written, one function reads it for the editor and the grammar, and a type is changed by rewriting the text

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Typed values" of [ADR-0025](0025-the-command-grammar.md) (`"1"` is a string, `1` an integer, `1.0` a float, `true` a boolean), "Editing" of [ADR-0009](0009-headers-exchange-support.md) (the type "is inferred from what is typed
  and can be overridden") and [ADR-0023](0023-header-integers-are-limited-to-safe-integers.md) (an integer is a safe integer), for what S8 ([#10](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/10)) types in a field.

## Context

The grammar has read a value since S2: `parseValue` takes the pieces of a word, with what was quoted, and a command that is refused for a value that is out of range is refused by `headerValueProblem`. A value field in the editor
is the same thing typed in a box, and ADR-0009 asks that its type be inferred in the same way and be overridable. Two readers would drift, and `"1"` against `1` is the whole lesson of the headers exchange. It has to be settled what the field
holds (a text or a text and a type), what the override does, and what is shown when it has been used.

## Decision

### One reader, in the domain

- **`readValue(segments, key)` is the reader of the grammar and `inferValue(text, key)` the reader of a field, and the second is the first with a tokenizer in front.** `parseValue` (what the pieces of a word say) and `headerValueProblem` (what
  the engine and the limits refuse) are called in one place, `readValue`, which the cursor of the grammar calls for every `name=value` and `header:name=value`, and `inferValue` calls after it has read the text as one word. `formatValue` is the inverse.
  They live in `syntax/values.ts`, with the table of cases that holds them.
- **The text of a field is a value as a command writes it after the `=`.** Quotes are syntax, as they are on the command line, and the field shows what the line will say. The two differences are made for a field that has no neighbouring words:
  **spaces round the text are not part of it** (`" 7 "` is the integer 7; to have spaces, quote them), and **text with spaces inside it, outside quotes, is a string as it was typed** (`my report`), where the command line would have made two
  words. An empty field is *not* the empty string: it is a value that has not been given ("A header needs a value"), and `""` is the empty string. (After an `=` on the command line, nothing is the empty string, because the `=` was typed.)
- **The type is a function of the text.** Nothing else is kept about a value: no flag that says that it was overridden. The type that a row shows is the type of what its text reads as.

### The table of cases

| Typed | Is | Why |
|---|---|---|
| `pdf`, `a.b`, `True`, `1x`, `NaN`, `null`, `Infinity` | the string as typed | any other word is a string; there is no null, and `True` is not `true` |
| `"pdf"`, `"1"`, `"1.0"`, `"true"`, `""` | the string inside the quotes | quotes make a string, whatever it looks like |
| `"a b"`, `"a\"b"`, `"line\nbreak"`, `"é"` | the string, with the escapes of JSON | the only escapes there are |
| `1`, `-1`, `007`, `0`, `-0` | the integer 1, -1, 7, 0, 0 | a whole number with an optional minus; there is no sign of a zero in an integer |
| `9007199254740991`, `-9007199254740991` | the integer | the largest that is safe (ADR-0023) |
| `9007199254740993`, `99999999999999999999` | refused | "An integer header must be a whole number from -9007199254740991 to 9007199254740991": write it in quotes to have a string |
| `1.0`, `1.50`, `-0.25`, `0.0` | the float 1, 1.5, -0.25, 0 | digits, a point, digits |
| `-0.0` | the float -0 | a float keeps the sign of its zero |
| `1e3`, `1E+3`, `1.5e-3` | the float 1000, 1000, 0.0015 | an exponent makes a float, as the broker's clients read it |
| `1e999` | refused | "A float header must be a finite number" |
| `+1`, `.5`, `5.`, `1,5`, `1_000`, `0x10`, `--1`, `1e` | the string as typed | not a number as written; a learner who wants one writes `1`, `0.5`, `5.0` |
| `true`, `false` | the boolean | lower case only |
| `7` with spaces round it | the integer 7 | the spaces are the field's |
| `my report`, `a=b`, `a->b`, `x;y` | the string as typed | spaces and the marks of the grammar are text in a field; the line quotes them |
| `1"0"` | the string `10` | a word with a quoted part is a string, as in a command |
| *nothing*, or only spaces | refused: "A header needs a value" | `""` is the empty string |
| `"abc`, `"a\qb"` | refused, with the grammar's words | the quote is not closed; there is no escape `\q` |

- **A value that is too long** (more than 10,000 characters of text, ADR-0029) is refused with the sentence the command gives.
- **`formatValue(inferValue(text))` writes the text in its one plain form**, and reading that gives the same value. That is a property of the domain, at 5,000 runs, for strings of any characters and numbers of every size.

### Changing a type rewrites the text

- **The control changes what the text says.** `retypeValue(text, type)` returns the text that reads as the same thing in another type, and the field shows it: `1` as a string is `"1"`, `"1"` as an integer is `1`, `1` as a float is `1.0`, `1.0` as an
  integer is `1`, `"true"` as a boolean is `true`, and `true` as a string is `"true"`. The row says it aloud ("Condition 2 is now a string: "1"."). There is no hidden state: what the field shows is the value, and the line
  under the editor says the same.
- **A change that has no meaning is refused where it was asked, and the text stays.** `"pdf"` is not a whole number, so it is not an integer; `1.5` has a fraction, so it is not an integer; `true` is a boolean, so it is not a number; `"yes"` is not
  `true` or `false`; `1e30` is beyond the safe range. The reason is under the row, root cause first, and the select goes back to the type that the text reads as. A number is never rounded to be changed: a text of digits is rewritten as digits,
  exactly, so that `"9007199254740993"` as an integer is `9007199254740993`, and the row then says why it is refused.
- **A string that holds a number is a number** when it is asked to be, and a number that is asked to be a string is the digits **as they were typed** (`1.50` is `"1.50"`, `007` is `"007"`), and not as they are printed.
- **While the field is empty the control is a preference.** Choosing a type for an empty value does not change any text, so the row keeps the choice until something is typed, and its reason ("A header needs a value: an integer, such as 7") and
  its placeholder say it. Once there is text, the type is the type of the text.
- **`exists` is a fifth choice and is not a type of value.** It takes the value away from the row and keeps the text, so that choosing a type again gives it back (ADR-0068).

## Consequences

### Positive

- The editor, the command bar, the log and the files cannot read a value differently, because one function reads it. The properties of the grammar (`parse(format(c)) = c`) hold for what the editor makes.
- A learner who sees `1` become `"1"` has been shown the rule that the lesson is about, in the place where they used it.
- There is no state that a value has and its text does not, so undo, the log and the line under the editor have nothing to keep in step.

### Negative / trade-offs

- A learner who wants the string `1` has to pick "string" or type the quotes. That is what the command line asks, and the control does it for them.
- Text with a space is a string in a field and two words on a command line, and the same text typed in two places is read in two ways. The line under the editor shows the quoted form, so that the difference is on the screen.
- A conversion that is refused is a click that did nothing, with a reason. It is better than a conversion that guesses.

## Alternatives considered

- **A type that is kept beside the text** (the override as a state, `"1"` typed as `1` with the type string). Rejected: two sources of truth for one value, a value that the line cannot say without quotes that the field does not have, and a reading of a
  quote that depends on the type.
- **Trim nothing, and read spaces as part of the text.** Rejected: `"7 "` as a string, from a stray space, is the trap that the tool is about, and a field that makes it is no help.
- **Refuse a text with a space unless it is quoted.** Rejected for a field: it asks for quotes where a person types a sentence, and the line under the editor already shows the quoted form.
- **A default for an empty field (`0`, `true`, `""`).** Rejected: it hides a value that was not given.
- **Round a number to change a type.** Rejected by ADR-0023 for the same reason as everywhere: nothing changes what routes without telling anyone.

## Related

- [ADR-0009](0009-headers-exchange-support.md), [ADR-0023](0023-header-integers-are-limited-to-safe-integers.md), [ADR-0025](0025-the-command-grammar.md), [ADR-0029](0029-the-commands-refuse-at-the-size-caps.md).
- [ADR-0066](0066-a-headers-binding-is-made-in-a-popover-and-edited-in-the-inspector-from-one-draft-and-an-edit-is-one-batch.md),
  [ADR-0068](0068-a-row-says-what-is-wrong-under-itself-a-duplicate-stops-the-commit-an-x-key-is-told-by-what-the-mode-does-with-it-and-a-lint-stays-a-lint.md).
- [M1 plan](../plans/m1.md), sections 2.1, 3 (S8) and 7.
