import { describe, expect, it } from 'vitest';

/**
 * What the setup of the specs does between two tests (`test-setup.ts`): the document that the specs of a worker share is emptied, so that an element that one put there by hand, with an id
 * that the next test also uses, is not what the next test finds. The tests of a file run in order, so the second says what the first left.
 */
describe('the document between two tests', () => {
  it('has what a test put in it by hand, for as long as the test lasts', () => {
    document.body.innerHTML = '<span id="label">left behind</span>';

    expect(document.getElementById('label')?.textContent).toBe('left behind');
  });

  it('is empty again for the next test', () => {
    expect(document.getElementById('label')).toBeNull();
    expect(document.body.childElementCount).toBe(0);
  });
});
