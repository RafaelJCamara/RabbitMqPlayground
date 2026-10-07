import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// A test of the app takes a second or two, but the pre-push hook runs them beside the lint, the build and the coverage of the libraries, on one machine, and
// a test that waits for a render can then take more than the five seconds that Vitest allows. The libraries and the tools have the same limit for the same
// reason (vitest.config.ts). A test that is wrong still fails: the limit only stops a machine that is busy from being a failure.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// The specs of a worker share one document, and what a test puts in it by hand (an element with an id, a page made of a string) is there for the next test that the worker runs, which
// then finds an `id="label"` that is not its own. Which test follows which depends on how the files are shared out, so the Nightly found it and the pushes did not. Nothing that a test makes outlives it.
afterEach(() => {
  document.body.replaceChildren();
});
