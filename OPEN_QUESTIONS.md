# Open questions

Decisions that are not made yet, collected on 2026-10-06 after S1
([#3](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/3)) was closed, and brought up to date after S2
([#4](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/4)), S3
([#5](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/5)) and S4
([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)). Each one says what is open, why, what the options
are, and which slice has to settle it. Once a question is answered, the answer goes into an ADR (or into the
[M1 plan](docs/plans/m1.md)), and the question is deleted from here. Numbers are not reused, so 1 and 9 are missing:
they were answered by [ADR-0024](docs/adr/0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md) and
[ADR-0029](docs/adr/0029-the-commands-refuse-at-the-size-caps.md).

| # | Question | Settled by |
|---|---|---|
| 2 | How does the engine report a refusal that closes the connection? | S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) |
| 3 | How are values that the scenario vocabulary cannot write recorded: an invalid `x-match`, an integer beyond 2^53? | S10 ([#12](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/12)) |
| 4 | How should a new scenario reach the Nightly record run, when the offline fixture spec refuses scenarios that have no fixture? | the repo owner |
| 5 | Should the repository pin its line endings with a `.gitattributes`? | the repo owner |
| 6 | Is the shape of the trace and of `explainMiss` right for the Why? overlay? | S7 ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) |
| 7 | Should the mutation-check helper be kept in the repository? | the repo owner |
| 8 | What does a second declaration of a name that is taken do, and what does an unbind of nothing do? | S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) |
| 10 | What do the home screen, the backup and "delete all" do with a canvas that cannot be read? | S9 ([#11](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/11)) |

## 2. How does the engine report a refusal that closes the connection?

The plan's dispatch sketch returns `{ ok: false; code: 403 | 404 | 406; text }`, and its events include `channel.closed`
([plan, section 2.2](docs/plans/m1.md)). The transient queue refusal is `541`, and the broker closes the connection, with
every channel and exclusive queue on it, and not only the channel. S1 reproduces only the publish refusals (403 and 404),
which close a channel.

Open: does the simulator have connections at all, or does each producer and consumer simply own a channel? If it does, the
code type widens to include 541 and says what was closed. If it does not, a transient queue is refused like any other
declaration, and the difference is dropped. Every recorded refusal keeps its level (`channel` or `connection`), so either
answer can be checked against the fixtures.

Where S2 left it: the type of a refusal code in `@rmq/engine` is `403 | 404 | 406 | 541`, so it already fits, and the
domain's refusal of a queue that is not durable carries the recorded `541` reply
([ADR-0024](docs/adr/0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md)). Nothing in the domain says
what a refusal closes, because nothing there has a channel or a connection yet.

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

## 5. Line endings

On Windows, with Git's default `core.autocrlf=true`, a checkout is CRLF. That fails `npm run format:check` and the
byte-for-byte fixture checks. S1 worked around it for one clone (`git config --local core.autocrlf false`, then restoring
the files). A root `.gitattributes` with `* text=auto eol=lf` would fix it for every clone, and a spec could pin it, as
`lefthook.yml` and `.gitignore` are pinned. It changes repository policy, so it has not been done.

Where S3 left it: nothing new needed it. The manifest of the schema fixtures hashes what a file parses to, and not its
bytes, and the specs that build the golden text of a file from a fixture read it with `\n` whatever the checkout has, so
that neither depends on line endings. The conformance fixtures and the specs that compare them byte for byte still do.

## 6. The shape of the trace and of `explainMiss`

S7 builds on both, and the shape is a first design: a visit for each exchange, with the binding that led there and every
binding that starts from it; a word alignment for a topic binding; pass, fail or ignored with a reason for each header
argument; and a tree of reasons for a miss. Four things I am not sure of:

- A topic miss says how far the pattern got. When a `#` takes the rest of the key and the next word then has nothing to
  match, it says `key-ran-out`. For `a.#.c` against `a.b.d` the pattern consumed the whole key and then needed a `c`, which
  reads oddly next to "the key does not end in c". The alternative is to report the last word that differed.
- The default exchange is a visit of type `default` with one implicit binding, or none.
- `topicSamples` fills wildcards with `x`, `y` and `z`, gives up to 4 matching and 5 non-matching keys, and leaves out any
  key over 255 bytes.
- `explainMiss` ends on `{ kind: 'cycle' }` instead of going round a cycle.

These are cheap to change now, and dearer once S7 renders them.

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
  68 new tests (the app's 553 became 621) and to stronger assertions in the ones that were there, and to about ten pieces of code that no
  input could reach being taken out (the kind of a node checked before an id is looked up, though ids are unique across kinds; the
  member-by-member comparison of a set that only grows or only shrinks; a shortcut of the selection that skipped a look at the edges; the
  title and the reset of the context menu). A second run, of the 1,098 mutants that the changes could affect, left 31
  survivors. 14 are in what only the e2e build has (the debug handle and its log of intents, which the end-to-end tier reads all day). 17 change
  nothing that can be seen: counters of ids, the debug names of injection tokens, `trim` and `trimEnd` before `Number`, a key compared in
  upper or lower case on both sides, a `kind` that nothing reads, a check that a name exists for an id that has a kind, the first value of a flag that every opening sets, and the classes of
  the buttons.
- **The inline templates (238 mutants):** each attribute, binding, listener and `@if` condition taken off or turned true and false. 139 were
  caught at once, 34 did not build, 65 survived. They led to tests of how each field of the inspector is described by its refusal, the steps of
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

The scripts are the same ones, plus a generator for templates, a runner for the hand changes and a picker of what to run again, and are still outside
the repository. The question of whether a tool should live in it is still open, and S4 makes the case for it a little stronger: a runner of the
hand changes, and the lint rule that came out of the templates, are the parts that other slices would use.

## 8. Declaring a name twice, and unbinding what is not bound

By RabbitMQ's documentation, a broker accepts a second declaration of an exchange or a queue with the same attributes, and
refuses one with other attributes with `406 PRECONDITION_FAILED` and a text that says which argument differs. No fixture
has either. The simulator refuses both with its own rule, that a canvas has each name once, and carries no reply of the
broker's ([ADR-0026](docs/adr/0026-commands-name-elements-and-ids-stay-in-the-document.md)). The recorded scenarios cannot
show the difference, because `validateScenario` refuses a step that declares a name twice and the vocabulary has no
`unbind` step. A refused step with other attributes can be recorded today, but the accepted repeat cannot.

Options:

- Keep the simulator's rule, and record the refused repeat so that the broker's `406` text is in a fixture.
- Make a repeat with the same attributes change nothing, and answer one with other attributes with the `406` text. That
  needs the vocabulary to allow a repeated declaration and an `unbind` step, and a scenario for each.
- Leave the rule as it is, and say in the messages that a broker would accept the repeat, once a fixture backs the claim.

S6 gives the engine its `dispatch` for `exchange.declare` and `queue.declare`, and has to say what the engine does with a
name that is there, so it is the slice that settles it. The domain's `declare` and `unbind` would follow.

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

## Follow-ups that are already owned

These are not questions. S2 replays the refusals at declare and bind time against the fixtures, through the commands: the
`amq.` names, the default exchange as a declared name or as a binding's source or destination, a missing queue or exchange
in a binding, a topic binding key with three `#` words, the transient queue, and a binding with two faults. The table is in
[ADR-0021](docs/adr/0021-transient-queues-are-refused.md) and
[ADR-0022](docs/adr/0022-topic-binding-keys-have-at-most-two-hash-wildcards.md). S6 has to replay the same declare and bind
steps through the engine's `dispatch`, which S1 could not do for lack of one.

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
