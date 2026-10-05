import { describe, expect, it } from 'vitest';
import { checkCommitMessage, COMMIT_TYPES, MAX_HEADER_LENGTH } from './commit-message';

describe('checkCommitMessage', () => {
  describe('accepts', () => {
    it.each([
      'feat: add the engine',
      'feat(engine): route messages through direct exchanges',
      'fix(app): keep the focus ring visible while panning',
      'docs(adr): add ADR-0021, short share links',
      'test(conformance): record the original simulator issue #10',
      'chore(deps): bump @angular/core from 22.2.0 to 22.2.1',
      'refactor(domain,engine): share the header value type',
      'feat(app/canvas)!: drop the old link gesture',
      'ci: run the nightly job on a schedule',
      'build(web): pin @foblex/flow',
      'perf(engine): avoid copying the queue',
      'style: format with prettier',
      'revert: feat(engine): route messages through direct exchanges',
    ])('%s', (header) => {
      expect(checkCommitMessage(header)).toEqual([]);
    });

    it.each(COMMIT_TYPES)('the type %s', (type) => {
      expect(checkCommitMessage(`${type}: do the thing`)).toEqual([]);
    });

    it('a header with a body and trailers after a blank line', () => {
      const message =
        'feat(app): add flags\n\nThe flags are read once.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n';

      expect(checkCommitMessage(message)).toEqual([]);
    });

    it('a header of exactly the maximum length', () => {
      const header = `feat: ${'x'.repeat(MAX_HEADER_LENGTH - 6)}`;

      expect(header).toHaveLength(MAX_HEADER_LENGTH);
      expect(checkCommitMessage(header)).toEqual([]);
    });

    it.each([
      'Merge branch "x" into main',
      'Merge pull request from a fork',
      'Revert "feat: add the engine"',
      'fixup! feat: add x',
      'squash! fix: y',
    ])('a message that git writes: %s', (message) => {
      expect(checkCommitMessage(message)).toEqual([]);
    });

    it('git comment lines before and after the message', () => {
      expect(
        checkCommitMessage('# Please enter the commit message\n\nfeat: add flags\n\n# Changes to be committed:\n'),
      ).toEqual([]);
    });

    it('Windows line endings', () => {
      expect(checkCommitMessage('feat: add flags\r\n\r\nBody\r\n')).toEqual([]);
    });
  });

  describe('rejects', () => {
    it.each([
      ['', /empty/],
      ['   \n\n', /empty/],
      ['# only comments\n# here\n', /empty/],
      ['add the engine', /type\(scope\): subject/],
      ['Add the engine', /type\(scope\): subject/],
      ['feat add the engine', /type\(scope\): subject/],
      ['feat:add the engine', /type\(scope\): subject/],
      ['feat : add the engine', /type\(scope\): subject/],
      ['feat(): add the engine', /scope/],
      ['feat(Engine): add the engine', /scope "Engine"/],
      ['feat(my engine): add the engine', /type\(scope\): subject/],
      ['feature: add the engine', /"feature" is not a commit type/],
      ['Feat: add the engine', /type\(scope\): subject/],
      ['wip: add the engine', /"wip" is not a commit type/],
      ['feat: ', /Say what changed/],
      ['feat:   ', /Say what changed/],
      ['feat: add the engine.', /full stop/],
      ['feat: add the engine.  ', /full stop/],
    ])('%j', (message, expected) => {
      const problems = checkCommitMessage(message);

      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(expected);
    });

    it('a first line that is too long', () => {
      const problems = checkCommitMessage(`feat: ${'x'.repeat(MAX_HEADER_LENGTH)}`);

      expect(problems).toEqual([expect.stringContaining(`Keep it to ${MAX_HEADER_LENGTH}`)]);
    });

    it('a body with no blank line before it', () => {
      expect(checkCommitMessage('feat: add flags\nThe flags are read once.')).toEqual([
        'Leave a blank line between the first line and the body.',
      ]);
    });

    it('a generated message whose body touches its first line', () => {
      expect(checkCommitMessage('Revert "feat: x"\nThis reverts commit abc.')).toEqual([
        'Leave a blank line between the first line and the body.',
      ]);
    });

    it('reports every problem at once, so one commit attempt is enough to fix them', () => {
      const problems = checkCommitMessage('wip(Bad Scope): done.\nbody');

      expect(problems.length).toBeGreaterThanOrEqual(2);
    });
  });
});
