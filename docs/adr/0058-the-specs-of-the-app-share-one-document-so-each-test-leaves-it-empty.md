# ADR-0058: The specs of the app share one document, so each test leaves it empty

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0036](0036-the-test-strategy-of-the-editor.md) (the unit tier of the app) and
  [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md) (what the setup of the app's specs gives them), for what the
  Nightly found after S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) was pushed.

## Context

The unit tests of the app (`ng test`, Vitest, jsdom) do not isolate their files: the specs that one worker takes share one document and one window, so that the 74 files do not each pay for a new one.
`TestBed` takes down what a component makes when its test ends. It does not know what a test put in the document by hand: a page made of a string (`document.body.innerHTML = …`, which the hit tests of the adapter use
for something to point at) or an element that a test appends to have somewhere for the focus to go.

The Nightly of 2026-10-07, with a random seed and 5,000 runs ([run 37606000416](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/runs/37606000416)), failed in six tests of `controls.spec.ts`: a `Switch` looks for its label by
`id="label"` and found the one that the hit tests had left in the body. Which spec follows which in a worker depends on how the files are shared out, which changes with the number of threads, the time that each file takes
and the order that the runner chose. The pre-push hook and CI did not put these two side by side, and the same seed and the same runs on the author's machine did not either. It was a defect of the tests and not of the code,
and it could have shown at any push.

## Decision

- **`test-setup.ts` empties the body of the document after every test of the app** (`afterEach(() => document.body.replaceChildren())`). Nothing that a test makes in the body outlives it. `test-setup.spec.ts` holds
  it: the first of two tests writes a page by hand, and the second, which runs after it in the same file, finds the body empty.
- **Only the body is emptied.** The attributes of the `html` element, `localStorage`, the address, `window` and the listeners on it are put back by the spec that changed them, in an `afterEach` of its own, as the specs of
  the theme and of the flags do.
- **A spec does not keep what is in the body from one test to the next**, and so does not build a page in a `beforeAll`. No spec did when this was decided.
- **The files are still not isolated.** `isolate` stays as the runner has it.

## Consequences

### Positive

- A page that a test writes by hand cannot be found by a test that comes after it, whatever the order of the files, and a new spec does not have to remember to take it down.
- The rule is in one place, and a spec says that it holds.

### Negative / trade-offs

- The head, the attributes of the `html` element and `window` can still carry something from one test to the next. Nothing has shown it, and the rule above says who puts it back. The way that it would show is the way that
  this one did, by a Nightly, and the answer then is to isolate the files.
- A spec that wants one page for all its tests has to build it in `beforeEach`.

## Alternatives considered

- **Isolate the files** (`isolate: true`). It would end the whole family of leaks, the head and the window included. Rejected for now: each of the 74 files pays for its own document and its own platform, in a hook that runs
  the tests of the app beside the lint, the build and the coverage of the libraries. It is what to do if a leak outside the body is ever found.
- **Make the one spec clean up after itself.** Right, and not enough: it is what `adapter-model.spec.ts` did not do, nothing would stop the next one from not doing it, and the failure is only seen where the order is lucky.
- **Run the failed job again.** Rejected, as ADR-0015 says of a test that fails, or that is flaky: the root cause is found and fixed, and a test is never retried to get green.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0036](0036-the-test-strategy-of-the-editor.md),
  [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md).
- [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md): what S6 settled that is easy to revisit.
