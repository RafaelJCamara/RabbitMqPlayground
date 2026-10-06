# Open questions

Decisions that are not made yet, collected on 2026-10-06 after S1
([#3](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/3)) was closed, and brought up to date after S2
([#4](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/4)). Each one says what is open, why, what the options
are, and which slice has to settle it. Once a question is answered, the answer goes into an ADR (or into the
[M1 plan](docs/plans/m1.md)), and the question is deleted from here. Numbers are not reused, so the first one is missing:
it was answered by [ADR-0024](docs/adr/0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md).

| # | Question | Settled by |
|---|---|---|
| 2 | How does the engine report a refusal that closes the connection? | S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) |
| 3 | How are values that the scenario vocabulary cannot write recorded: an invalid `x-match`, an integer beyond 2^53? | S10 ([#12](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/12)) |
| 4 | How should a new scenario reach the Nightly record run, when the offline fixture spec refuses scenarios that have no fixture? | the repo owner |
| 5 | Should the repository pin its line endings with a `.gitattributes`? | the repo owner |
| 6 | Is the shape of the trace and of `explainMiss` right for the Why? overlay? | S7 ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) |
| 7 | Should the mutation-check helper be kept in the repository? | the repo owner |
| 8 | What does a second declaration of a name that is taken do, and what does an unbind of nothing do? | S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) |

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

## 5. Line endings

On Windows, with Git's default `core.autocrlf=true`, a checkout is CRLF. That fails `npm run format:check` and the
byte-for-byte fixture checks. S1 worked around it for one clone (`git config --local core.autocrlf false`, then restoring
the files). A root `.gitattributes` with `* text=auto eol=lf` would fix it for every clone, and a spec could pin it, as
`lefthook.yml` and `.gitignore` are pinned. It changes repository policy, so it has not been done.

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

Options: commit it as a tool (for example `web/tools/mutation/`) with the mutant lists beside the specs, or keep mutation
checking as a manual practice that each slice reports in its commit messages.

## 8. Declaring a name twice, and unbinding what is not bound

A broker accepts a second declaration of an exchange or a queue with the same attributes, and refuses one with other
attributes with `406 PRECONDITION_FAILED` and a text that says which argument differs. The simulator refuses both with its
own rule, that a canvas has each name once, and carries no reply of the broker's
([ADR-0026](docs/adr/0026-commands-name-elements-and-ids-stay-in-the-document.md)). The recorded scenarios cannot show the
difference, because `validateScenario` refuses a step that declares a name twice and the vocabulary has no `unbind` step. A
refused step with other attributes can be recorded today, but the accepted repeat cannot.

Options:

- Keep the simulator's rule, and record the refused repeat so that the broker's `406` text is in a fixture.
- Make a repeat with the same attributes change nothing, and answer one with other attributes with the `406` text. That
  needs the vocabulary to allow a repeated declaration and an `unbind` step, and a scenario for each.
- Leave it as it is, and say so in the messages, which they already do for the commands that are quieter on a broker.

S6 gives the engine its `dispatch` for `exchange.declare` and `queue.declare`, and has to say what the engine does with a
name that is there, so it is the slice that settles it. The domain's `declare` and `unbind` would follow.

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

## Follow-ups that are already owned

These are not questions. S2 replays the refusals at declare and bind time against the fixtures, through the commands: the
`amq.` names, the default exchange as a declared name or as a binding's source or destination, a missing queue or exchange
in a binding, a topic binding key with three `#` words, the transient queue, and a binding with two faults. The table is in
[ADR-0021](docs/adr/0021-transient-queues-are-refused.md) and
[ADR-0022](docs/adr/0022-topic-binding-keys-have-at-most-two-hash-wildcards.md). S6 has to replay the same declare and bind
steps through the engine's `dispatch`, which S1 could not do for lack of one.
