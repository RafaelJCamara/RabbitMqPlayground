# Open questions

Decisions that are not made yet, collected on 2026-10-06 after S1
([#3](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/3)) was closed, and brought up to date after S2
([#4](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/4)), S3
([#5](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/5)), S4
([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) S5
([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7)) and S6
([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)). Each one says what is open, why, what the options
are, and which slice has to settle it. Once a question is answered, the answer goes into an ADR (or into the
[M1 plan](docs/plans/m1.md)), and the question is deleted from here. Numbers are not reused, so 1, 2, 6, 8 and 9 are missing:
they were answered by [ADR-0024](docs/adr/0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md),
[ADR-0029](docs/adr/0029-the-commands-refuse-at-the-size-caps.md),
[ADR-0050](docs/adr/0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md) and
[ADR-0051](docs/adr/0051-a-declaration-that-repeats-is-idempotent-an-unbind-of-nothing-changes-nothing-and-a-406-names-the-attribute.md), and 6 by
[ADR-0059](docs/adr/0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md).

| # | Question | Settled by |
|---|---|---|
| 3 | How are values that the scenario vocabulary cannot write recorded: an invalid `x-match`, an integer beyond 2^53? | S10 ([#12](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/12)) |
| 4 | How should a new scenario reach the Nightly record run, when the offline fixture spec refuses scenarios that have no fixture? | the repo owner |
| 5 | Should the repository pin its line endings with a `.gitattributes`? | the repo owner |
| 7 | Should the mutation-check helper be kept in the repository? | the repo owner |
| 10 | What do the home screen, the backup and "delete all" do with a canvas that cannot be read? | S9 ([#11](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/11)) |

## 3. Values that the scenario vocabulary cannot write

ADR-0009 says that the broker rejects an `x-match` other than the four modes. I saw that on 4.3.6 by hand on 2026-10-05,
with a probe that is not in the repository:

- `406 PRECONDITION_FAILED - Invalid x-match field value <<"bogus">>; expected all, any, all-with-x, or any-with-x`;
- `406 PRECONDITION_FAILED - Invalid x-match field type byte (value 1); expected longstr`.

No fixture records it, because a scenario's `xMatch` can only be one of the four modes or `null`. The same goes for the
exact comparison of integers beyond 2^53 behind [ADR-0023](docs/adr/0023-header-integers-are-limited-to-safe-integers.md),
which was also seen only by hand, because a scenario writes a number and a JSON number has the same limit.

Options: widen the vocabulary when a slice needs it (S10's importer), with a raw argument that the engine's replay treats
as refused by validation; or leave these as notes in the ADRs.

Where S2 left it: the typed command and the document cannot say either value. `x-match` is one of the four modes, an integer
has to be a safe integer (`headerValueIssue`), and the grammar and the schema refuse the rest
([ADR-0025](docs/adr/0025-the-command-grammar.md)), so the engine never meets one. What is left is a file that holds one,
which the importer of that file has to refuse (S10), and whether it is worth a scenario.

## 4. New scenarios and the Nightly record run

[CONTRIBUTING](CONTRIBUTING.md) says to record fixtures by running the Nightly workflow in record mode. But
`committed-fixtures.spec.ts` requires the committed fixtures to be exactly the scenarios, and the pre-push hook and CI run
it, so a push that adds a scenario without its fixture is refused.

In S1 I recorded locally first (`CONFORMANCE_MODE=record npm run test:conformance`, which uses Testcontainers), pushed the
scenarios and their fixtures together, and then ran the Nightly record as a cross-check. It gave the same 82 files, byte
for byte. That needs Docker on the developer's machine, and the cloud container that the plan describes has none.

Options:

- Keep it, and say in CONTRIBUTING that the Nightly record is a cross-check, and that recording needs Docker.
- Record from a ref that the hook does not see, for example a non-branch ref such as `refs/conformance/record/<run id>`.
  Every push goes through the hook, so this needs a way to create that ref that is not a `git push`. I did not want to
  propose a way around the hook.
- Let the offline spec accept scenarios that are listed as waiting for a recording. That weakens the one check that says a
  fixture is a faithful record.

My lean is the first. It affects every slice that adds fixtures: S6 (delivery) and S10 (export replay). The log of a record
run is about 250 KB for the full set, and `dump restore` reads the output of `gh run view --log` as it is.

Where S3 left it: S3 has no broker and added no scenario. Its fixtures, `fixtures/schema/vN`, are documents that the app
writes and not recordings of a broker, so they do not meet this question. They are pinned by a manifest of hashes instead,
and a spec fails on a file that was edited ([ADR-0027](docs/adr/0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md)).

Where S6 left it: S6 added 22 scenarios, 13 of routing and 9 of delivery, and did what S1 did. It recorded them on Docker first
(`CONFORMANCE_MODE=record`, Testcontainers, the pinned image), pushed them with their fixtures, and the 83 that were there came out
byte for byte as they were. The Nightly run in verify mode then played all 105 against the broker of CI. It is the same cost as in S1, and
it still needs Docker on the machine of whoever adds a scenario, which the cloud container has not got, so the question is as open as it was.

## 5. Line endings

On Windows, with Git's default `core.autocrlf=true`, a checkout is CRLF. That fails `npm run format:check` and the
byte-for-byte fixture checks. S1 worked around it for one clone (`git config --local core.autocrlf false`, then restoring
the files). A root `.gitattributes` with `* text=auto eol=lf` would fix it for every clone, and a spec could pin it, as
`lefthook.yml` and `.gitignore` are pinned. It changes repository policy, so it has not been done.

Where S3 left it: nothing new needed it. The manifest of the schema fixtures hashes what a file parses to, and not its
bytes, and the specs that build the golden text of a file from a fixture read it with `\n` whatever the checkout has, so
that neither depends on line endings. The conformance fixtures and the specs that compare them byte for byte still do.

## 7. Mutation checks

ADR-0015 and the plan ask for tests that fail when the code is wrong, and S1 checked every new spec by hand: break the code,
watch the right test fail, restore it. To do that quickly I used a small helper that applies one change, runs the specs,
says whether any test failed, and always restores the file. It lives outside the repository, so nobody else can re-run
those checks, and its lists of mutants (about 150) are not kept.

S2 was too big for mutants that are picked by hand, so I generated them. About 450 lines of scripts, outside the repository
as well, walk the syntax tree of the new code with the TypeScript compiler and make a mutant for each comparison,
condition, boolean, block, string, number, array and method call (the operators of Stryker). 3,924 mutants of the S2 code
ran in twelve copies of `web/`, first against the specs that sit nearest and then against every spec of the three
libraries. 3,680 died at once. The 244 that survived led to about fifty new tests and assertions, which kill 123 of them,
and `npm run docs:check` kills 23 more. They covered what no test had read: messages, the other fields of a consumer when
one is set, the sharing that a delete that touches nothing has to keep, the exact places of an auto-layout, every value of
every enumeration, the items that completion offers. 98 mutants are left, and each was read: 86 change nothing that can be
seen (a guard that the next line makes redundant, a default that is never used, a constant that every kind of node shares,
the order of a sort that only has to be the same every time), and 12 are in `topicSamples` of S1, which S2 did not touch.
The same scripts ran each of the three properties alone against 722 of the mutants: `undo∘apply`, `parse∘format` and
`reconcile` together kill 355 that way, and the replay of the fixtures kills 170, 20 of which the properties let through.

Options: commit the generator and the runner as a tool (for example `web/tools/mutation/`, which needs nothing but
TypeScript, and takes about 45 minutes for S2 on twelve workers), with a list of the equivalent mutants beside it, or keep
mutation checking as a manual practice that each slice reports in its commit messages.

Where S3 left it: S3 ran the same scripts, unchanged, over `@rmq/persistence`. What differs from one slice to the next is two
arguments, and a tool in the repository would take them: the files to mutate (`gen.mjs` takes absolute paths, and its default
targets are S2's) and the specs to run (`run.mjs --projects=persistence --filters=projects/persistence/src/lib/`, because its
file heuristics do not know persistence). A first run of 1,241 mutants took about 7 minutes on twelve workers, and the specs
caught 1,179 of them. The 62
that survived led to about two dozen tests and assertions (the words of messages that no test read, the later producer or
binding that a cap looks at and not only the first, boundaries such as 40 characters or a file exactly as long as a file may
be) and to simplifications of code that a mutant showed to be redundant: the fast path and a callback of the connection to the
database, an argument of the shape checks that no message used, and the copy of a record that is not there. One survivor was
more than that. A branch that closed a connection when an event came late for it had hidden that a connection that arrives
after its store was closed was never closed, and a spec now shows that it is. A second run left 13 and a third, on the final
code, 1,213 mutants and 6 survivors. All six change nothing that can be seen: the name of the phase in three calls of
`classifyStorageError` (anything but `'open'` means `'use'`), the guard that stops a timer that is not running, the default of
`allowDeleted` (what is just made has no deletion), and the clean-up of an open that fails after another has replaced it,
which cannot be built.

Where S4 left it: S4 used the same generator, with the app's files for its targets (46 files of `core/`, `canvas/model/` and `editor/`; the
Foblex adapter is outside the unit specs), and three other ways, because a generator that walks the syntax tree does not enter decorators
and cannot reach the adapter.

- **The code (AST mutants):** 2,178 mutants, of which 897 did not build and 1,110 of the other 1,281 were caught. The 171 survivors led to
  63 new tests (the app's 553 became 616) and to stronger assertions in the ones that were there, and to about ten pieces of code that no
  input could reach being taken out (the kind of a node checked before an id is looked up, though ids are unique across kinds; the
  member-by-member comparison of a set that only grows or only shrinks; a shortcut of the selection that skipped a look at the edges; the
  title and the reset of the context menu). A second run, of the 1,098 mutants that the changes could affect, left 31
  survivors. 14 are in what only the e2e build has (the debug handle and its log of intents, which the end-to-end tier reads all day). 17 change
  nothing that can be seen: counters of ids, the debug names of injection tokens, `trim` and `trimEnd` before `Number`, a key compared in
  upper or lower case on both sides, a `kind` that nothing reads, a check that a name exists for an id that has a kind, the first value of a flag that every opening sets, and the classes of
  the buttons.
- **The inline templates (238 mutants):** each attribute, binding, listener and `@if` condition taken off or turned true and false. 139 were
  caught at once, 34 did not build, 65 survived. They led to five more tests (621), and to stronger assertions, of how each field of the inspector is described by its refusal, the steps of
  the number fields, the names of the groups of the top bar, and what is drawn while a canvas is being opened; to two things that nothing used
  being taken out; and to the linter's `button-has-type`, because 15 mutants that took the type off a button were seen by no test and the
  linter sees all 15 (it applies to inline templates, which was checked). 18 are left: the size of an icon (16) and `type="text"` (2).
- **The adapter and the end-to-end tier (29 changes by hand):** each built into the e2e bundle and run against the tests that should notice
  it. 23 were caught. Four were not and are now: the selection that the editor makes was not pushed into the library, a fit was not capped at 100%
  (every test had several nodes), and the zoom had no tested ends. One was an attribute that nothing read, and is gone. One cannot be told: a
  handle that is not armed having the list of the one that is. The worst find came from the plan of one of the changes and not from running
  it: the test that the plan called for, a right click on the empty canvas with one node selected, failed on the code that was there. The check of the
  target of the event, which the change would have removed, told nothing, and that right click opened the menu of the selected node
  ([ADR-0040](docs/adr/0040-a-menu-on-the-canvas-itself-is-for-a-key-and-the-last-thing-done-says-whether-it-was-one.md)).

Where S5 left it: S5 used the same scripts, with one more (`keep-changed.mjs`), because a slice that changes a file in a few places should be mutated in those places,
and not in the whole of a file that is mostly older code. It keeps the mutants that are in a line that the slice added or changed since the commit before it, which cut
the 3,344 mutants of the 47 files of `core/`, `canvas/model/`, `command-bar/` and `editor/` to the 2,009 that are in a line that S5 changed.

- **The domain (162 mutants** in what S5 changed there: `help`, `wordText` and the refusal of a first word that is no command): 156 were caught. Of the six that were not, five
  are tests now (a name that is quoted in part, the first word being what a refusal is about, `help` alone being a command with no topic and not a command that is
  undefined, a verb that has only one command of two words), and one changes nothing that can be seen: the space in `startsWith(name + ' ')`, which the completer filters again.
- **The code of the app (2,009 mutants** in the changed lines): 699 did not build, 1,106 of the other 1,310 were caught, and 204 were not. Those and the templates below led to 49 new tests in 17 specs,
  and to stronger assertions in many more (the app's tests went from 1,085 to 1,132), and to eighteen pieces of code that no input could reach being taken out: the quadratic curve that the path reader had for an edge type that the app does not
  use, two guards of the point at a fraction that a line with a length cannot meet, the overlap and the size of a label as one expression each, the pieces of the link flow that
  were there for a node that is not on the canvas, for a reason that is never missing and for a command that is not a link, the group of producers in the picker, which nothing is linked to, the
  call that cleared a timer that a flag already ignored, and a condition of the view of an edge that its rows already made. A second run of the 903 mutants that the changes could
  affect left 74, and a third, of the code as it ended, left 59. Each of the 59 was read, and none can be seen: 13 are the counters and the ids that tell two components of one kind apart,
  which matter only if two are on a page; 6 are classes, a selector and a default that every caller replaces; 10 are the first value of something that the next line sets
  (the cursor and the flag of typing of the bar, `-1` that is `-2`, the seed of the best place of a label); 3 are `trim` or `trimEnd` where only whether something is left is asked;
  and 27 are guards and exits that are there for speed or for safety and change nothing (the early exit of the greedy placement, which the strict `<` makes unneeded for the result;
  the tie between two places that are as near; a vertex that two pieces share; the guard against a division by nothing in the picker and in a line of no length, which `NaN` passes through; the
  other thing that is asked for being closed when one is opened, which the focus does as well; a sentence for an exchange that has nothing to link to, which cannot be, since it can be bound to
  itself; a node and its link that are not a batch, which a point always makes one; the `undefined` that a key with nothing in it is).
- **The inline templates (285 mutants** in the changed lines): 39 did not build, 175 were caught at once, and 71 were not. 17 of those removed the type of a button, and the linter's
  `button-has-type` sees all 17, as in S4. The others led to eight of those tests and to assertions in a dozen more: what is hidden from a screen reader (the arrow, the prompt, the words that name a group, the icon of the theme), the
  ids that the field, the list, the panel and the answer are pointed at by, that the list has its name and its options are out of the order of Tab, that a press in the list leaves the cursor
  in the field and Enter on an option takes it, that a refusal marks a field invalid in the bar and in both fields of the inspector, that a link has no section of bindings, that a
  clean binding has no warning and no note of header arguments, the steps of the place of a label, the regions and the scroll of the cheat-sheet, the reason that the picker gives and the
  titles of the icons. 19 are left and change nothing that a test can see: the type of a text field (4), the size of an icon (13), the `submit` of a button that is one by default, and a
  detail of an option that every option has.
- **The adapter and the end-to-end tier (42 changes by hand)**: the labels (their place, the drag, the press, the card and its hover), the lines that are dashed, and everything that keeps the default
  exchange from being the document's (the menu, the double click, the drag, the connectors). 23 were caught at once. 19 were not, and what they showed is the most useful thing that the
  sweeps found: nothing in the browser saw where the labels are put, so the greedy placement of ADR-0044 had its unit specs and no journey, and the same went for a drag by a button that is
  not the main one, a press that moves a little, the card that a press takes away and a finger makes appear for a moment, the dashes, and each of the ways that the default exchange is left
  alone. Thirteen journeys (one of them of the contract suite) were written for them, and 12 of the 19 are caught now. One of the 19 was a guard that cannot be reached, and is gone. Seven
  are left: the wait of 120 milliseconds before the labels are placed (a label that jumps while a node is dragged is a thing that no state at the end can show), a timer that is not
  cleared and a set of places that is set again (both do the same work twice), the placing of the labels again when the geometry changes (which the document changing does at once,
  and the geometry only when the library draws the paths after the document, a moment later than the wait), a drag by a second pointer (a label is captured by the pointer that pressed it, so none other
  reaches it), the input of the default exchange being disabled (the list of the targets that the rules allow already leaves it out), and a label that carries only a lint (none of the
  lints of M1 is on an edge that has no chip).
- **The replay**: the property of ADR-0046 was checked by hand changes of the code that it is about (ids that a refused batch spent, an undo that was not logged), which it finds at the 100
  runs of the hook, and it ran at 5,000 runs with seven seeds when it was written, and with nine more after the mutations had changed the link flow, and once at 40,000.

Where S6 left it: S6 used the same scripts on the engine, which is new, on what it changed in the domain, the testing library and the conformance tool, and on the app, in the lines that it changed.
Three things were new. The copies are made, and brought up to date, by one script (`make-copies.ps1 -Sync`), because the command that did it was forgotten twice. The runner of the app
stops at the first test that fails, and a mutant of the runtime is looked for first in the specs that are about it and not in the editor and the replay: a first try with both took 90 seconds for a
mutant on twelve workers (three hours), and the second took about 20 a minute. And the ready list of a queue has a getter, `retained`, so that a spec can see that it is let go of.

- **The engine (1,143 mutants** of 14 files, with the properties at 1,000 runs): 1,022 were caught, 14 looped, which is a catch, and 107 were not. What they had in common is that no test read it: a consumer that was
  found to be full, and what happens to it when another consumer of the queue acknowledges (a bug in `unblock` would have starved it, and two specs now say who is served); the consumers that a channel keeps when one
  of them is cancelled, deleted with its queue or cleared; a close that called back what was on its way to another channel; the bindings that a deleted queue or exchange takes, and the ones that it must leave; the
  sentences of fifteen `RangeError`s, which no test read; what `cleared` and `counters.reset` say when only one thing was counted; where a producer's tick is among what happens at its time when something other than its
  interval changes. 53 tests were written (the engine's 854 became 907) and six pieces of code that nothing reaches were taken out: the early answer of `hasRoom` for a consumer that acknowledges by itself, which holds nothing,
  the list of the queues that a close touches (a set does it), the check that a binding is there before it is written again, the check that a consumer is not cancelled before a change of prefetch, the early return of
  `removeTick`, and the defaults of a producer, which every field wrote over. A second run of 732 mutants, of the files that changed and of what had survived, left 18, each read: 10 are in the signature of a binding (the order of
  a sort whose keys are unique, and the value of a condition that `exists` does not have, which are the same JSON), 4 are counters that only have to change (`nextSeq`, `version` twice, `nextOrder`), 3 are in the
  heap (a `seq` is never used twice, and the size of the sign of a comparator) and 1 is in the ready list (an `order` is never used twice).
- **The domain (451 mutants** in the lines that S6 changed), **the testing library (121)** and **the conformance tool (70)**: 440, 104 and 69 were caught. The ones that were not had the words of a batch with `redo` in
  it, the shape of a `publish` that has no key and no payload (a property that is `undefined` is a property, to `toStrictEqual`), the sentence for a key of 256 bytes, and the helpers of the specs of the engine, which
  had no spec of their own and now have (12 tests, so the libraries went from 4,051 tests to 4,116). The two options of a message were written twice, for `set` and for `publish`, and are one definition now, which a spec
  of the first holds for the second. Left: 4 of the domain (a guard that the next line makes redundant, and the verb that a refusal says, which is the same sentence for anything but `declare`), 3 of the testing library
  (the handle of a frame that only has to be one, and how long `settle` goes) and none of the tool.
- **The code of the app (1,347 mutants** in the changed lines): 520 did not build, 712 were caught and one looped, and 114 were not. They led to 36 tests (the app's 1,446 are 1,482) in a dozen specs and to the removal of what
  they showed to be unneeded (the cap of a tween that the frame has already ended, the special case of a prefetch of 0, which 0 times anything is, the zoom and the document in the effect of the overlay, which
  the canvas that moves and the simulation already say, and an attribute, `transform`, that the host of the canvas has no use for). What nothing had read: that the longest frame is a hundred milliseconds and not the
  name of the constant, a quarter of the speed being a quarter of a millisecond for the engine, the way that the picture goes from where the last step left it, what a queue that is deleted loses (what it held and what its
  consumers held), the thirty frames after which the colours are read again, the size of the canvas to the nearest pixel and only when the host changes, the thirty-two parts of an edge, the dot and the ring, the
  names, the limits and the words for one and for many of every part of the inspector, and a refusal that must go when the learner gives a field what the document has. One of them was a defect: a number given again as it was
  cleared the refusal under its field and left the one on the status line (a text did both), and they are the same call now. A second run of the 385 mutants that the changes could affect and a third of the 72 that were
  left, with the editor and the replay among the specs, left 23, each read: 8 are names (of an injection token, of a selector, which only a build sees, and of a field that is never refused), 7 are counters, ids and the first
  value of something that the next line sets, 2 only make a run faster (the cache of a path, and the places that are worked out again), `trim` against `trimEnd` where only an empty text is asked, `every` and `some` over the subscriptions of a
  consumer, which all have the one acknowledgement that the consumer has, the guard of `simulationState`, which only the end-to-end build has (2), and the classes of the buttons (2).
- **The inline templates (152 mutants)**: 23 did not build, 80 were caught, 49 were not. The names of the regions and of their headings, the limits of the number fields, the `aria-invalid` and `aria-describedby` of the fields of the
  composer, the bindings of a queue's list and `@if (more() > 0)` led to tests. 15 are left: 7 take the type off a button, and the linter's `button-has-type` catches all 7, 7 are the size of an icon, and 1 is `type="text"`.
- **The browser (31 changes by hand)**: the flag, the keys, what wakes the overlay, what is drawn and where, the clock and the picture of a step. 21 were caught at once and 10 were not. Of the 10, two (the full stop and `P` without
  the flag) were not seen because a test that says that a refusal did not come looked before it could, and now waits for two frames of the page; one (the speed) had no journey that measured it, and the clock of the page,
  which Playwright advances, now says that a second of it is a quarter, one and four seconds of the simulation at the three speeds; three were dependencies that nothing needed, one attribute and two signals of the effect of the overlay,
  and are gone; and four are caught by unit specs and cannot be by a browser with one hop in every canvas, a picture that settles before a test looks, and an edge that is also said to be drawn by its path
  (`edges.spec.ts`, `simulation.spec.ts` and `overlay.spec.ts`, each shown by the same change made to the tree). Two more were written after, because the sweep showed what the first thirty had not looked at: **nothing read the pixels that
  the overlay paints** (a journey reads the canvas at the place that `overlayFrame` says, and at none other, and finds it clear when nothing is on its way), and **a node that was dragged while the clock was stopped did not take its
  messages with it** until it was let go, which ADR-0055 says it does (a journey holds a node and moves it, and the watcher of the edges tells the viewport that a path is drawn another way now). It is one of the two defects of the slice
  that a mutant found and that a learner would have seen, the other being the refusal that stayed on the status line.
- **The replay and the properties**: the property of ADR-0046 plays the commands of the runtime and the steps of the clock, and the properties of the engine ran at 5,000 runs with five seeds (11, 222, 3333, 44444 and
  555555) for the three libraries, and with three (7, 808 and 90909) for the app, after the last change of the engine.

The scripts are the same ones, plus a generator for templates, a runner for the hand changes, a picker of what to run again, the keeper of the lines that changed and, since S6, a script that makes the copies. They are
still outside the repository. The question of whether a tool should live in it is still open, and S6 makes the case for it stronger again: the mutation check was the way that two defects were found (the status line that
kept a refusal, and a node that was dragged and did not take its messages), it took about four hours of a machine with 32 threads, and each of its commands, the copies, the keeper of the lines, the picker and the
runner with its own filters, is easy to get wrong without the one that wrote them.

## 10. Canvases that cannot be read

`list()` answers the canvases that it can read, and, apart from them, the ones that it cannot: their id, their name if the
record still has one, and why ([ADR-0028](docs/adr/0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md)). The
learner can delete one, and "delete all" puts a tombstone on it too. A backup is made of the canvases that can be read, so it
cannot hold one that a newer version of the app wrote, or one that is damaged.

Open: what the home screen shows for such a canvas and what it offers (the reason, "delete", perhaps "download what is
there"); whether "delete all" has to say that it will delete canvases that no backup can hold; and whether a backup should
carry the record of an unreadable canvas as it is, so that a newer version of the app can read it later. The last would need
`list()` to give the raw record, which it does not. S9 builds the screens that have to say it.

What S4 does meanwhile, which S9 may keep or change: the editor opens the canvas that was open last if it can be read, else the
most recent one that can, else it makes one, and it leaves every canvas that cannot be read untouched. It says how many there
are, in a line of the status strip, with the reason that nothing was changed, and offers nothing to do about them.

## Decisions taken in S1 that are easy to revisit

- `route()` throws a `RangeError` for a routing key over 255 bytes and for a header value that is not exact, and does not
  return a refusal, because no broker reply exists: the client library refuses before anything is sent. The alternative is a
  typed result, so that a what-if tester need not check first (`routingKeyIssue` and `headerValueIssue` exist for that).
- The recorded refusal texts write the vhost as `/`, because the runner gives each scenario a vhost of its own.
- The engine's `Topology` is by names, with a `vhost`. Ids stay in the domain.

## Decisions taken in S2 that are easy to revisit

- The typed command has four verbs that the plan does not list: `unlink`, `unsubscribe`, `unset` and `move label`. A gesture
  that takes a link, a subscription or a header away, or drags the label of an edge, needs a command to be logged as.
- Auto-layout leaves room for nodes of a size that is a guess (`NODE_SIZE`, 140 to 160 by 56). The app may replace it with
  the sizes that it draws.
- The wording of every message is a first draft, written for someone who is learning. S4 and S5 will find the ones that
  read badly on a screen.
- A queue that is not durable is refused as a rule of the whole document, so a file that has one cannot be loaded. The
  alternative, to load it and show a lint, would let a canvas exist that cannot be exported.

## Decisions taken in S3 that are easy to revisit

- **The size caps are numbers that a person chose**: 2,000 elements, 5,000 edges, 100 header entries on one message or binding,
  10,000 characters in a payload or a header value, 50,000,000 characters in a file, 1,000 canvases in a backup and 200
  characters in a name. They are ten times what the plan runs. The four that are about a canvas are the domain's `LIMITS`,
  and the commands refuse at them ([ADR-0029](docs/adr/0029-the-commands-refuse-at-the-size-caps.md)).
- **A tombstone lives 60 seconds.** It backs an Undo toast and is not a bin, so that a canvas that the learner deleted is gone
  from the disk soon. A "recently deleted" screen would need more.
- **Autosave waits 500 ms after the last change, and has no longest wait.** A learner who changes the canvas every 400 ms for
  ten minutes is saved once, at the end. The commands are gestures and not a stream, and the app flushes when the page is
  hidden, but a longest wait is a few lines if profiling shows that a change is lost.
- **The storage warning is raised at 80% of the quota, and made stronger at 95%.** The percent that it writes is rounded down.
- **A name is any text that is not blank, up to 200 characters, and an id is 1 to 64 letters, digits, `.`, `:`, `_` or `-`.**
  Two canvases may have the same name.
- **A record is migrated when it is read and rewritten when it is saved**, and not when the database is upgraded, so that
  going back to an older version of the app finds the canvases that it can still read. The cost is that an old record is
  migrated on every read until the learner edits it.
- **Every envelope is strict**: the record, the file of one canvas and the backup refuse a key that they do not have, as the
  document does. A file that was edited by hand and has an extra key is refused and told which one, and not read and changed.
- **`save` and `put` write over what is there.** `save` refuses a canvas that cannot be read, so that what a newer version of
  the app wrote is never written over, and `put`, which an import uses, writes over anything, because the learner chose it.
- **`restore` of an id that is not a tombstone is `not-found`, and `restoreAll` ignores such ids**, so that an Undo of "delete all"
  brings back what is still there, and says which, even if some tombstones were purged.
- **The in-memory repository is a real one.** It is the repository that the app's specs use, and the one that the app can fall
  back on in a browser that keeps nothing, and a contract spec of 84 cases runs on it and on IndexedDB.

## Decisions taken in S4 that are easy to revisit

- **A node is drawn at the size of `NODE_SIZE`**, so the guess of S2 is the size that the canvas draws, and the auto-layout leaves
  room for exactly that ([ADR-0032](docs/adr/0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md)). A longer name is
  cut with an ellipsis on the canvas, and whole in the inspector and in the label that a screen reader reads.
- **A node dropped from the toolbox lands where the middle of its preview was**, and not under the pointer, because the library puts
  the preview off the pointer when the canvas is not at 100% ([ADR-0033](docs/adr/0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md)).
  If that costs more workarounds, the first thing to replace is the library's drag from the toolbox with one of our own.
- **Fit and "bring into view" show the whole canvas, at 100% or less, and do not centre on one node**, so that adding something far
  away does not hide what is already there. A canvas that is bigger than the window is shown small, and zoom is from 25% to 200%.
  The app works the fit out from where its nodes are and writes it into the library's transform, because the library's own fit did
  not always come for a canvas with no edges ([ADR-0038](docs/adr/0038-the-app-fits-the-canvas-and-does-not-ask-the-library-to.md)).
- **The note that the browser did not promise to keep the canvases is dismissed for as long as the page is open**, and comes back
  the next time, until the browser agrees. It is not remembered between visits, because it is about the learner's data.
- **The quota test makes the browser refuse at its API**, because the protocol's override of the quota changes neither the estimate
  nor the outcome of a write of a canvas ([ADR-0037](docs/adr/0037-the-editors-keys-are-heard-on-the-document-and-the-browsers-refusal-is-made-at-its-api.md)).
  It is worth trying the protocol again when Chromium is upgraded.
- **The hint bar names the keys of the canvas for what is selected, and the table of shortcuts is the one place that lists them**
  ([ADR-0035](docs/adr/0035-the-keyboard-service-scope-modifiers-and-text-fields.md)). Held keys do not repeat an action, undo and
  redo included, which some editors let a learner hold down.
- **The first wording of the messages was read on a screen**, and three were changed: a position that is not on the canvas says
  whose position it is, and the status line says "the repeat setting" and "the default exchange setting" where it had said "whether
  it repeats" and "whether the default exchange is shown", which did not read after "changed … of producer sender". The rest read
  well enough in the inspector and the status strip, and S5 will meet the ones about links.
- **A context menu is for the one thing that was pointed at.** Right-clicking one of several selected nodes selects that one, and
  Rename and Delete in the menu act on it alone, while the Delete key still acts on everything that is selected. Some editors let the
  menu act on the whole selection. That is a bigger menu (Rename means nothing for two nodes), and it can wait for a reason to build it.
- **A right click on the empty canvas is the browser's**, even with one node selected: the menu of ours is for a node, an edge, or a key
  ([ADR-0040](docs/adr/0040-a-menu-on-the-canvas-itself-is-for-a-key-and-the-last-thing-done-says-whether-it-was-one.md)). A menu of our own
  for the empty canvas ("Add here", "Paste") is a feature for later, and S9 may want it.
- **The menu holds the click that opened it** ([ADR-0039](docs/adr/0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md)).
  macOS and Linux open it while the button is still down, and the first run of the tests on Linux, in CI, found it: the author's
  machine sends the events in the other order. The tests now send both orders on every system. If the CDK guards the way that the menu
  is opened here some day, the hold can go.
- **The inspector shows only what S4 can explain**: name, position, the type and flags of an exchange, the durable switch of a
  queue, and for any node what it is joined to. What a producer sends and how a consumer takes messages is S6's and S8's.

## Decisions taken in S5 that are easy to revisit

- **A binding asks for its key before it exists** ([ADR-0041](docs/adr/0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md)).
  From a direct or a topic exchange the popover opens first, and Enter makes the whole `bind`, so undo is one step and the line in the log is the one that a
  learner would type. The alternative, a binding with an empty key that the learner then edits, is two steps and a binding that matches almost nothing in between.
- **An id is spent only by a command that is accepted** ([ADR-0046](docs/adr/0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md)).
  The bus takes the ids back when a command or a batch is refused, and without that a log typed again would make other ids than the gestures did. A later
  slice that makes ids outside the bus would break that, and the replay property is the test that says so.
- **The default exchange is a node that is not in the document** ([ADR-0043](docs/adr/0043-the-default-exchange-is-shown-on-request-and-is-not-in-the-document.md)):
  `~default` cannot be an id, it is read-only and can be selected, it is put a row above the highest exchange, and a producer's link to a queue is drawn through
  it when it is shown. It cannot be dragged. If a learner is to move it, the layout has to hold more than ids.
- **The command bar is a panel in the layout, and not a palette over the canvas** ([ADR-0045](docs/adr/0045-the-command-bar-a-panel-that-types-through-the-same-door.md)).
  It costs a line of the window when it is closed, and it never covers the node that has the focus. Ctrl/Cmd+K works in a field of text, and `/` does not, and what
  was typed is kept when the bar is closed ([ADR-0048](docs/adr/0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md)).
- **The log of equivalent commands is the session's: 1,000 lines, in memory, never saved with the canvas.** The history of the bar is 100 lines in `localStorage`
  (`rmq.command-history`), because it is about the person and not about the document. A canvas that is opened has an empty log, and S7's event log is meant to show
  the lines beside the events.
- **The card of the first run is a few chips, and goes for good with the first edge or "Got it"** (`rmq.how-to-link`). The cheat-sheet has the whole sentence of each
  way. The tour of S11 may replace the card.
- **A label is three chips and "+N more", at a place that is a thousandth of the way along its edge, and the greedy placement runs 120 ms after the geometry
  is still** ([ADR-0044](docs/adr/0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md)). The size of a label is worked out from
  6.6 pixels for a character and not measured, so that it can be placed before anything is drawn. A second pass with the measured sizes is what to do if a
  learner ever sees two labels meet.
- **What the bar suggests on a canvas that lacks something uses example names**: `orders`, `billing`, `sender` and `worker` for what is missing, and the names
  of the canvas for what is to be bound. They are not names that a canvas has to have, and a learner who takes a suggestion gets those names. The "did you mean"
  buttons write the name that was probably meant in place of the words at fault, quoted when the grammar needs it.
- **The wordings that S5 added are still first drafts**, as ADR-0025 says. Two changed once they were seen on a screen: the sentence that the library speaks when `L`
  starts a link now says what the keys are, and the card of the first run is a few chips where it was a list of sentences. The refusals of `help` and of a first word
  that is not a command, and the sentence for a command that changed nothing ("Nothing changed, because the canvas already is as that command says."), were read when
  their specs were written and not since. A bad one is mended with a small domain commit and its test.
- **The reader of the paths of the edges knows `M`, `L` and `C`**, which is what the `bezier` type of edge draws ([ADR-0049](docs/adr/0049-the-reader-of-paths-knows-what-the-bezier-edge-draws-and-a-browser-holds-where-labels-are-put.md)). The `segment` type draws a rounded bend with `Q`, so a slice
  that changes the type has to teach `path.ts` the command, and its spec says that a path that goes on with a `Q` is read as far as the command.
- **The persistence note and the card of the first run move the canvas, once each, and the tests of the browser do not wait for the note.** The note that the
  browser did not promise to keep the canvases takes 66 pixels about 300 ms after the first change, and the card gives its 58 back when the first edge is made.
  A learner sees a canvas that moves under the first thing that they do. The tests are given the promise ([ADR-0048](docs/adr/0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md)),
  and the note is tested alone. Room kept for the note, or a note that is drawn over the status bar, would stop the move.

## Decisions taken in S6 that are easy to revisit

- **The simulation starts playing, at 1×**, and stands still while nothing is scheduled ([ADR-0054](docs/adr/0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md)).
  A canvas with a producer that repeats starts to send as soon as it is opened, which the tests of the browser avoid by pausing first. If that surprises a learner, the simulation can start
  stopped, and a template of S11 can say `play`.
- **A step jumps the clock and moves the picture over a quarter of a second** ([ADR-0055](docs/adr/0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md)),
  and a frame is taken to last at most 100 ms and the first after a rest none ([ADR-0057](docs/adr/0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md)).
  Both are constants (`STEP_TWEEN_MS`, `MAX_FRAME_MS`), and neither has been tried on a slow machine.
- **Undo restores the design and not the simulation**: an undo that deletes a queue that holds messages loses them, and the line says how many ("3 messages were lost"). The alternative is to
  keep the engine's state in the undo history, which would make every step of the clock an entry of it.
- **A change of how a consumer acknowledges, and of the name of a queue, starts it again**, so what it held goes back to its queue and comes again as redelivered. It is what a broker does, and
  a learner sees it the first time as a surprise. A change of prefetch applies at once, where a broker applies it to the consumers that start later ([ADR-0053](docs/adr/0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md)).
- **A refused publish does not stop the producer** ([ADR-0050](docs/adr/0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md)): a client library would see its
  channel closed. The `refused` event and the sentence say what the broker said, and there is no connection to close.
- **The slots of a consumer show what it may hold in all**: its prefetch times its subscriptions that are alive, because the window is counted for each tag. A learner who gives one consumer two queues
  sees twice the places. Drawing a row for each tag would say it better, and needs a place for it under the node.
- **A message has one of eight colours, by a hash of its routing key**, so two keys can have the same one, and the key as a word, the ring and the badge say the rest. The hash is FNV-1a and
  the palette is in `styles.css` as tokens, so it is a change of a few files to make it bigger (the tokens, the list and the spec that holds their contrast).
- **The numbers of a node are words under its box, and a picture beside them** ([ADR-0056](docs/adr/0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md)):
  up to eight squares for a queue and eight places for a consumer, and `+N` for the rest. The list of the messages of a queue has the first fifty (`LIST_LIMIT`), ready first and then held.
- **More than 500 messages in flight are regrouped by edge and by thirty-second of the way**, so that a burst of thousands is a few dozen shapes, and a shape stands for the messages that were
  near. At most 12 shapes have their key written beside them. Where the limits are (`SHAPE_LIMIT`, `DENSE_PARTS`, `LABELLED_LIMIT`) is a matter of taste, and S12 measures on hardware.
- **The composer does not edit the headers of a message**: it says how many it has and that the table to edit them comes with the headers exchange (S8). The command `publish … header:name=value` and
  `set <producer> header:name=value` already do.
- **`speed` takes any number from 0.25 to 4, and the strip has five buttons**: 0.25, 0.5, 1, 2 and 4. A learner who types `speed 3` gets 3.
- **Without the flag the bar completes, explains and lists the runtime verbs, and the bus refuses to run them** ([ADR-0057](docs/adr/0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md)),
  so that the grammar is one thing and `docs/commands.md` is true of it. The alternative is that the verbs are not in the bar until the flag is on, which would make `help` differ from the document that is generated.
- **The sentences of the events are first drafts**, as ADR-0025 says of every wording: "Stepped: message 1 is in billing; billing gave message 1 to worker." was read on a screen once, and the two that
  join several events with a semicolon are the ones to look at first. They are in `core/runtime/sentences.ts`, and S7's log may want its own.
- **The seed of the engine is read and kept, and nothing draws from it in M1.** The engine is deterministic without randomness, as ADR-0007 says; the generator is there, is part of a snapshot, and
  is what a later jitter or a failure that is injected would use, which is a change that does not alter any of the events of today.
- **The strip costs a row of the window (about 44 pixels) for anyone who has the flag**, whether or not they ever press play ([ADR-0056](docs/adr/0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md)).
- **What the overlay paints is checked by one journey of pixels and by what it says it drew** (`overlayFrame`), and not by comparing pictures, which are the browser's to change.
- **What wakes the overlay is a canvas that moves, a path that is drawn another way, an edge that is drawn, the theme and the preference for motion.** [ADR-0057](docs/adr/0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md)
  says that the adapter watches the `style` and the `transform` of the canvas's host: it watches `style` only now, since the host is not an SVG element, and a path that is drawn another way, which is what a node that is dragged
  makes, tells the viewport too. The mutation check of the browser found it (a node that was held while the clock was stopped left its messages behind). The zoom and the document are not in the effect: the first moves the canvas,
  and the simulation wakes the loop for the second.
- **The speed is held by the clock of the page**, which a test advances (`page.clock`), and not by waiting: a second of it is 244 milliseconds of the simulation at a quarter of the speed, and the tests accept a little less than
  the whole, since the first frame after a rest lasts no time.
- **The specs of the app are not isolated, and the body of their shared document is emptied after each test** ([ADR-0058](docs/adr/0058-the-specs-of-the-app-share-one-document-so-each-test-leaves-it-empty.md)). The Nightly of the random seed found a spec that found
  another's `id="label"`, in a way that no push and no run at the same seed on one machine could repeat. The head, the attributes of the `html` element and the window are not emptied: the specs that change them put them
  back, and if a leak is ever found there, the answer is to isolate the files, which costs a document for each of the 74.

## Follow-ups that are already owned

These are not questions. S2 replays the refusals at declare and bind time against the fixtures, through the commands: the
`amq.` names, the default exchange as a declared name or as a binding's source or destination, a missing queue or exchange
in a binding, a topic binding key with three `#` words, the transient queue, and a binding with two faults. The table is in
[ADR-0021](docs/adr/0021-transient-queues-are-refused.md) and
[ADR-0022](docs/adr/0022-topic-binding-keys-have-at-most-two-hash-wildcards.md). S6 had to replay the same declare and bind
steps through the engine's `dispatch`, which S1 could not do for lack of one, and it does: `fixtures.spec.ts` of the engine plays 103 of the 105 fixtures through `dispatch`, twice (with no
latency and with the latency of a new canvas), and compares what each consumer was given, what each queue kept and every refusal with what was recorded. The two that it leaves out use an exclusive
queue, which arrives with connections in M3, and are listed with that reason.

S3 hands on what the app has to wire, in the order that the slices come
([ADR-0028](docs/adr/0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md)):

- **S4** (done, [ADR-0031](docs/adr/0031-the-editors-state-the-command-bus-and-where-ids-come-from.md)) makes the repository with `Date.now` and `crypto.randomUUID`, and calls `purgeExpired()` when it starts. It makes the
  autosave of the one implicit canvas, calls `flush()` when the page is hidden (`visibilitychange`, `pagehide`), shows what each
  write came to, and asks `requestPersistence(navigator.storage)` after the first save, and not at start. It shows
  `quotaWarning` when a save fails with `quota-exceeded`, or from `readUsage`.
- **S9** builds the screens on `softDelete`, `softDeleteAll`, `restore` and `restoreAll` for the Undo toasts, the backup on
  `writeBackup` and `parseBackup` (what to do with an id that is taken is its choice, and `put` is the door), and the JSON
  files on `writeCanvasFile` and `parseCanvasFile`. It owns the reminder to make a backup, which the meta store only holds the
  times of. It decides question 10.
- **S10** ends the decoding of a share link in `loadCanvas` and nothing of its own, so that the caps, the versions and the
  errors are the same as a file's. The limits of the codec itself are bytes before there is any data, and are its own.

S6 hands on what the next slices read, in the order that they come ([ADR-0052](docs/adr/0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0054](docs/adr/0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md)):

- **S7** (the Why? overlay and the event log) reads `Simulation.onEvents`, which tells its listener the events that each command and each advance of the clock made, in order, and `describeEvent` for the sentence of
  each. The `routed` and `unroutable` events have the `trace` of S1 and `routed` has the `paths` that its message took ([ADR-0059](docs/adr/0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md) settled the shape of the trace and of `explainMiss`). The log of equivalent commands already holds the lines of the
  runtime verbs, in the same store, which is where S7 shows them beside the events (ADR-0046).
- **S8** (headers) gives the composer its table of headers. The grammar, the engine and `reconcile` carry headers already, and the composer says how many there are.
- **S9** (the screens of the canvases) and **S10** (share and export) have no engine in what is saved: a canvas that is opened has a new engine, and nothing of a simulation that was running is kept with the canvas or in a
  file. The share panel of S10 offers the topology "only or with messages", and the messages are the engine's snapshot (versioned JSON, `snapshot()` and `restore()`, ADR-0052), which the app does not call yet. S9 has
  to decide whether a canvas that is saved keeps one. The seed and the three latencies are in the document's settings, and so they are in every file.
- **S11** (the tour and the templates) can start a template with `pause` and drive the simulation with `publish` and `step`, as the tests of the browser do, since they are commands.
- **S12** measures the frame rates of the overlay on real hardware, with the burst and the big canvas that `e2e/performance.spec.ts` has, whose budget of three seconds to draw 200 nodes and 500 edges holds with the flag on.
