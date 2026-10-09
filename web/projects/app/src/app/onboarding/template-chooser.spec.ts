import { TestBed } from '@angular/core/testing';
import { TEMPLATES } from '@rmq/domain';
import { APP_DISCLAIMER } from '../core/app-info';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { OnboardingDialogs } from './dialogs';
import { BLANK } from './template-chooser';

/** The question of what to start with, and the service that asks it (ADR-0082). */

const WELCOME = 'Welcome to RabbitMQ Playground';
const FROM_THE_HOME = 'New canvas from a template';

afterEach(() => {
  document.body.replaceChildren();
});

/** The module is configured by the first question of a test, and the flags it names are the ones for the rest of it. */
let configured = false;

async function ask(first: boolean, flags = 'editor,canvases,simulation,onboarding') {
  if (!configured) {
    TestBed.configureTestingModule({
      providers: [{ provide: FLAG_SOURCES, useValue: { stored: null, query: flags } }],
    });
    configured = true;
  }
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  const dialogs = TestBed.inject(OnboardingDialogs);
  const answer = dialogs.choose({ first });
  const dialog = await screen.findByRole('dialog', { name: first ? WELCOME : FROM_THE_HOME });
  return { dialog, answer, opener, dialogs, user: userEvent.setup() };
}

const escape = (): boolean =>
  fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

describe('the chooser (ADR-0082)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    configured = false;
  });

  describe('at the first run', () => {
    it('says that the product is not affiliated with Broadcom or the RabbitMQ project, which a visitor reads first (ADR-0087), and the question from the home does not repeat it', async () => {
      const first = await ask(true);
      expect(within(first.dialog).getByText(APP_DISCLAIMER)).toBeVisible();
      first.dialog.closest('.cdk-overlay-container')?.remove();
      TestBed.resetTestingModule();
      document.body.replaceChildren();
      configured = false;

      const fromHome = await ask(false);

      expect(within(fromHome.dialog).queryByTestId('chooser-disclaimer')).not.toBeInTheDocument();
    });

    it('is a modal dialog that welcomes, says what a canvas is and what can be done, and has no way to say never mind', async () => {
      const { dialog } = await ask(true);

      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(within(dialog).getByRole('heading', { level: 2, name: WELCOME })).toBeVisible();
      expect(dialog).toHaveTextContent(
        'A canvas is where you draw how messages travel. Start from one of the tutorials of RabbitMQ, build your own from nothing, or take a short tour.',
      );
      expect(within(dialog).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('lists the six templates, each as a button with its name and what it shows, in the order of the tutorials', async () => {
      const { dialog } = await ask(true);

      const list = within(dialog).getByRole('list', { name: 'Templates' });
      const buttons = within(list).getAllByRole('button');
      expect(buttons.map((button) => button.querySelector('span')?.textContent)).toEqual([
        'Hello World',
        'Work Queues',
        'Pub/Sub',
        'Routing',
        'Topics',
        'Headers routing',
      ]);
      TEMPLATES.forEach((template, index) => {
        expect(buttons[index]).toHaveTextContent(template.summary);
      });
    });

    it('offers building from scratch, and the tour', async () => {
      const { dialog } = await ask(true);

      expect(within(dialog).getByRole('button', { name: 'Build from scratch' })).toBeEnabled();
      expect(within(dialog).getByRole('button', { name: 'Take the tour (about a minute)' })).toBeEnabled();
    });

    it.each(TEMPLATES)('answers the template $name when its button is pressed', async ({ id, name }) => {
      const { dialog, answer, user } = await ask(true);

      await user.click(within(dialog).getByRole('button', { name: new RegExp(`^${name}`) }));

      expect(await answer).toEqual({ kind: 'template', id });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('answers building from scratch, and the tour, when their buttons are pressed', async () => {
      const first = await ask(true);
      await first.user.click(within(first.dialog).getByRole('button', { name: 'Build from scratch' }));
      expect(await first.answer).toEqual({ kind: 'blank' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const second = await ask(true);
      await second.user.click(within(second.dialog).getByRole('button', { name: 'Take the tour (about a minute)' }));
      expect(await second.answer).toEqual({ kind: 'tour' });
    });

    it('means building from scratch when it is left with Escape, so that the learner is never left without a canvas', async () => {
      const { dialog, answer } = await ask(true);
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

      escape();

      expect(await answer).toEqual(BLANK);
    });

    it('means building from scratch when the learner presses the backdrop', async () => {
      const { answer } = await ask(true);

      fireEvent.click(document.querySelector('.cdk-overlay-backdrop') as Element);

      expect(await answer).toEqual(BLANK);
    });
  });

  describe('from the home', () => {
    it('is named for what it makes, says that each opens as a new canvas, and has a way to say never mind', async () => {
      const { dialog } = await ask(false);

      expect(within(dialog).getByRole('heading', { level: 2, name: FROM_THE_HOME })).toBeVisible();
      expect(dialog).toHaveTextContent('Each one opens as a new canvas, with its own name.');
      expect(dialog).not.toHaveTextContent('Welcome');
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(within(dialog).getAllByRole('button')).toHaveLength(TEMPLATES.length + 3);
    });

    it('answers the template that was chosen', async () => {
      const { dialog, answer, user } = await ask(false);

      await user.click(within(dialog).getByRole('button', { name: /^Topics/ }));

      expect(await answer).toEqual({ kind: 'template', id: 'topics' });
    });

    it('answers nothing for Cancel, for Escape and for the backdrop, because the learner asked for a template and changed their mind', async () => {
      const cancelled = await ask(false);
      await cancelled.user.click(within(cancelled.dialog).getByRole('button', { name: 'Cancel' }));
      expect(await cancelled.answer).toBeUndefined();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const escaped = await ask(false);
      await waitFor(() => expect(escaped.dialog.contains(document.activeElement)).toBe(true));
      escape();
      expect(await escaped.answer).toBeUndefined();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const behind = await ask(false);
      fireEvent.click(document.querySelector('.cdk-overlay-backdrop') as Element);
      expect(await behind.answer).toBeUndefined();
    });
  });

  describe('as a dialog', () => {
    it('puts the cursor in it, and gives it back to what had it when it closes', async () => {
      const { dialog, opener, answer, user } = await ask(true);
      // Which control has it is a matter of layout, which jsdom has none of: a browser test checks that it is the first template.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

      await user.click(within(dialog).getByRole('button', { name: 'Build from scratch' }));
      await answer;

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    });

    it('is asked once at a time: a second question while it is open is not asked, and the first is still answered', async () => {
      const { dialogs, dialog, answer, user } = await ask(true);

      const second = await dialogs.choose({ first: false });

      expect(second).toBeUndefined();
      expect(document.querySelectorAll('.cdk-dialog-container')).toHaveLength(1);
      await user.click(within(dialog).getByRole('button', { name: /^Routing/ }));
      expect(await answer).toEqual({ kind: 'template', id: 'routing' });
    });

    it('can be asked again once it was answered', async () => {
      const { dialogs, dialog, answer, user } = await ask(true);
      await user.click(within(dialog).getByRole('button', { name: 'Build from scratch' }));
      await answer;
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const again = dialogs.choose({ first: false });

      expect(await screen.findByRole('dialog', { name: FROM_THE_HOME })).toBeInTheDocument();
      escape();
      expect(await again).toBeUndefined();
    });
  });
});
