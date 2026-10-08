import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CanvasDocument } from '@rmq/domain';
import {
  createMemoryRepository,
  type CanvasRepository,
  type Outcome,
  type RepositoryError,
  type Shared,
} from '@rmq/persistence';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  idSequence,
  manualClock,
  producerRecord,
  queueRecord,
  snapshotAfter,
} from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { copiesIn } from '../core/runtime/copies';
import { REPOSITORIES } from '../core/session/canvas-storage';
import { LinkOpening } from '../core/share/link-opening';
import { SHARED_CANVAS_PROVIDERS, SharedCanvas } from './shared-canvas';

/** The things a shared canvas is given by the view that provides it: a storage of its own over memory, above the storage of the page. */
@Component({ selector: 'rmq-host', template: '', providers: SHARED_CANVAS_PROVIDERS })
class Host {
  readonly canvas = inject(SharedCanvas);
}

const unavailable: RepositoryError = {
  kind: 'unavailable',
  message: 'The browser does not let this site keep canvases.',
};
const full: RepositoryError = {
  kind: 'quota-exceeded',
  message: 'The browser has no room left to keep this canvas. Nothing was saved.',
};
const broken: RepositoryError = { kind: 'failed', message: 'The browser failed to read or save canvases (boom).' };

type Failing = Partial<Record<'list' | 'create' | 'get' | 'getMeta' | 'purgeExpired', RepositoryError>>;

/** A repository that answers like the one given, except that some calls fail. */
function failing(repository: CanvasRepository, fail: Failing): CanvasRepository {
  const wrapped = { ...repository } as CanvasRepository;
  for (const [name, error] of Object.entries(fail)) {
    (wrapped as unknown as Record<string, () => Promise<Outcome<never, RepositoryError>>>)[name] = async () => ({
      ok: false,
      error,
    });
  }
  return wrapped;
}

/** A producer `sender` that sends `burst` messages to the queue `billing` through the exchange `orders`: a canvas that has messages on its way when the clock has run a while. */
const traffic = (burst = 2): CanvasDocument =>
  documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst, interval: { everyMs: 1_000, on: false } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  });

const canvasOf = (name = 'Orders flow'): Shared => ({
  name,
  document: documentOf({ queues: { q1: queueRecord('billing') } }),
});

interface Options {
  readonly flags?: string;
  /** What the learner’s browser does to the repository it keeps their canvases in. */
  readonly learner?: (repository: CanvasRepository) => CanvasRepository;
  /** What happens to the repository in memory that the view keeps the shared canvas in. */
  readonly view?: (repository: CanvasRepository) => CanvasRepository;
}

function setup(options: Options = {}) {
  const clock = manualClock(8_000_000);
  const learner = createMemoryRepository({ now: clock.now, newId: idSequence('own') });
  const made = { browser: 0, memory: 0 };
  const memories: CanvasRepository[] = [];
  const leave = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: REPOSITORIES,
        useValue: {
          browser: () => {
            made.browser += 1;
            return options.learner?.(learner) ?? learner;
          },
          memory: () => {
            made.memory += 1;
            const memory = createMemoryRepository({ now: clock.now, newId: idSequence(`view${made.memory}-`) });
            memories.push(memory);
            // The first of them is the view’s own; the next is where the page of the learner falls back to if the browser keeps nothing.
            return made.memory === 1 ? (options.view?.(memory) ?? memory) : memory;
          },
        },
      },
      { provide: LinkOpening, useValue: { leave } },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: options.flags ?? 'editor' } },
    ],
  });
  const canvas = TestBed.createComponent(Host).componentInstance.canvas;
  return { canvas, clock, learner, made, memories, leave };
}

/** An editor that is open: it writes when it is told to, and a spec decides when that is done. Once it is, a write is done at once. */
function editorOf(id: string) {
  const flushes: (() => void)[] = [];
  let finished = false;
  return {
    editor: {
      id,
      flush: vi.fn(() => (finished ? Promise.resolve() : new Promise<void>((resolve) => flushes.push(resolve)))),
    },
    finish: () => {
      finished = true;
      flushes.forEach((done) => done());
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const namesIn = async (repository: CanvasRepository): Promise<string[]> => {
  const listed = await repository.list();
  return listed.ok ? listed.value.canvases.map(({ name }) => name) : [];
};

/** A canvas that is open, in memory, and its id. */
async function opened(options: Options = {}, shared: Shared = canvasOf()) {
  const harness = setup(options);
  await harness.canvas.open(shared);
  const id = harness.canvas.canvasToOpen() ?? '';
  return { ...harness, id };
}

describe('SharedCanvas (ADR-0078)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('opening the canvas of a link', () => {
    it('puts it in memory under an id of its own, with the name and the document of the link, and offers it to the session', async () => {
      const { canvas, memories, id } = await opened();

      expect(canvas.ready()).toBe(true);
      expect(canvas.failure()).toBeNull();
      expect(id).not.toBe('');
      const record = await memories[0]?.get(id);
      expect(record?.ok && record.value.name).toBe('Orders flow');
      expect(record?.ok && Object.values(record.value.document.queues).map(({ name }) => name)).toEqual(['billing']);
    });

    it('is not ready, and offers no canvas, until the canvas is in memory', async () => {
      const { canvas } = setup();

      expect(canvas.ready()).toBe(false);
      expect(canvas.canvasToOpen()).toBeUndefined();
    });

    it('has nothing to say of messages, a name or a copy before there is a link, whatever the flags', async () => {
      const { canvas } = setup({ flags: 'editor' });

      expect(canvas.notice()).toBeNull();
      expect(canvas.messages()).toBeNull();
      expect(canvas.name()).toBe('');
      expect(canvas.saving()).toBe(false);
      expect(canvas.problem()).toBeNull();
    });

    it('says the name that the link gave, as it is', async () => {
      const { canvas } = await opened({}, canvasOf('<b>Orders</b> & “co”'));

      expect(canvas.name()).toBe('<b>Orders</b> & “co”');
    });

    it('keeps nothing in the browser: the learner’s storage is not so much as opened, and has no canvas of theirs touched', async () => {
      const { learner, made } = await opened();

      expect(made.browser).toBe(0);
      expect(await namesIn(learner)).toEqual([]);
    });

    it('is not ready, and says why, when the canvas could not be put in memory', async () => {
      const { canvas } = setup({ view: (memory) => failing(memory, { create: broken }) });

      await canvas.open(canvasOf());

      expect(canvas.ready()).toBe(false);
      expect(canvas.canvasToOpen()).toBeUndefined();
      expect(canvas.failure()).toBe(
        'The shared canvas could not be opened. The browser failed to read or save canvases (boom).',
      );
    });
  });

  describe('the messages of the link', () => {
    it('has none to give, and says nothing of them, when the link carries none', async () => {
      const { canvas } = await opened();

      expect(canvas.messages()).toBeNull();
      expect(canvas.notice()).toBeNull();
    });

    it('gives the snapshot of the link to the simulation, and says nothing while it is put back', async () => {
      const snapshot = snapshotAfter(traffic(), 180);
      const { canvas } = await opened({ flags: 'editor,simulation' }, { ...canvasOf(), simulation: snapshot });

      expect(canvas.messages()?.snapshot).toBe(snapshot);
      expect(canvas.notice()).toBeNull();
    });

    it('says that they could not be put back, and why, when the simulation says so: the canvas is shown without them', async () => {
      const { canvas } = await opened(
        { flags: 'editor,simulation' },
        { ...canvasOf(), simulation: snapshotAfter(traffic(), 180) },
      );

      canvas.messages()?.failed('This engine reads snapshots of version 1, and this one is version 2');

      expect(canvas.notice()).toBe(
        'The messages of this link could not be put back (This engine reads snapshots of version 1, and this one is version 2), so the canvas is shown without them.',
      );
    });

    it('says that the simulation is not switched on, and how many messages the link carries, when the flag is off', async () => {
      const snapshot = snapshotAfter(traffic(2), 180);
      const { canvas } = await opened({ flags: 'editor' }, { ...canvasOf(), simulation: snapshot });

      expect(copiesIn(snapshot)).toBe(2);
      expect(canvas.notice()).toBe(
        'This link carries 2 messages, but the simulation is not switched on yet, so they are not shown. It is still being built: add ?ff=simulation to the address to try it.',
      );
    });

    it('says one message in the singular', async () => {
      const snapshot = snapshotAfter(traffic(1), 180);
      const { canvas } = await opened({ flags: 'editor' }, { ...canvasOf(), simulation: snapshot });

      expect(canvas.notice()).toMatch(/^This link carries 1 message, but /);
    });

    it('does not complain of the flag when the snapshot of the link has no message in it', async () => {
      const { canvas } = await opened(
        { flags: 'editor' },
        { ...canvasOf(), simulation: snapshotAfter(canvasOf().document, 0) },
      );

      expect(canvas.notice()).toBeNull();
    });
  });

  describe('the editor that is open', () => {
    it('is the one that a copy waits for', async () => {
      const { canvas, id, learner } = await opened();
      const { editor, finish } = editorOf(id);
      canvas.attach(editor);

      const saving = canvas.saveCopy();
      await settle();
      expect(editor.flush).toHaveBeenCalledTimes(1);
      expect(await namesIn(learner)).toEqual([]);
      finish();
      await saving;

      expect(await namesIn(learner)).toEqual(['Orders flow (shared)']);
    });

    it('is forgotten when it is gone, and a copy does not wait for it', async () => {
      const { canvas, id, learner } = await opened();
      const { editor } = editorOf(id);

      canvas.attach(editor)();
      await canvas.saveCopy();

      expect(editor.flush).not.toHaveBeenCalled();
      expect(await namesIn(learner)).toEqual(['Orders flow (shared)']);
    });

    it('keeps the editor that came after it when the one before says that it is gone', async () => {
      const { canvas, id } = await opened();
      const first = editorOf(id);
      const second = editorOf(id);

      const goneFirst = canvas.attach(first.editor);
      canvas.attach(second.editor);
      goneFirst();
      first.finish();
      second.finish();
      await canvas.saveCopy();

      expect(second.editor.flush).toHaveBeenCalledTimes(1);
      expect(first.editor.flush).not.toHaveBeenCalled();
    });
  });

  describe('saving a copy', () => {
    it('makes a canvas of the learner’s own, called after the link, with “(shared)” added, and with what the learner changed here', async () => {
      const { canvas, id, learner, memories } = await opened();
      const changed = documentOf({ queues: { q1: queueRecord('billing'), q2: queueRecord('audit') } });
      await memories[0]?.save(id, { document: changed });

      await canvas.saveCopy();

      const listed = await learner.list();
      const [copy] = listed.ok ? listed.value.canvases : [];
      expect(listed.ok && listed.value.canvases).toHaveLength(1);
      expect(copy?.name).toBe('Orders flow (shared)');
      expect(copy?.document).toEqual(changed);
      expect(copy?.id).not.toBe(id);
    });

    it('takes the first “(shared)” name that nobody has, and never writes over a canvas of the learner’s', async () => {
      const { canvas, learner } = await opened();
      await learner.create({ name: 'Orders flow', document: documentOf({}) });
      await learner.create({ name: 'Orders flow (shared)', document: documentOf({}) });

      await canvas.saveCopy();

      expect((await namesIn(learner)).sort()).toEqual([
        'Orders flow',
        'Orders flow (shared 2)',
        'Orders flow (shared)',
      ]);
    });

    it('makes the copy the canvas that was open last, and puts it at the end of the strip of the canvases that the learner had open', async () => {
      const { canvas, learner } = await opened();
      await learner.create({ id: 'a', name: 'Alpha', document: documentOf({}) });
      await learner.create({ id: 'b', name: 'Beta', document: documentOf({}) });
      await learner.setMeta('openCanvases', ['b', 'a']);
      await learner.setMeta('lastOpenCanvas', 'a');

      await canvas.saveCopy();

      const listed = await learner.list();
      const copy = listed.ok ? listed.value.canvases.find(({ name }) => name === 'Orders flow (shared)') : undefined;
      expect(copy).toBeDefined();
      expect(await learner.getMeta('lastOpenCanvas')).toEqual({ ok: true, value: copy?.id });
      expect(await learner.getMeta('openCanvases')).toEqual({ ok: true, value: ['b', 'a', copy?.id] });
    });

    it('makes the strip of the copy alone when the learner had none', async () => {
      const { canvas, learner } = await opened();

      await canvas.saveCopy();

      const listed = await learner.list();
      const copy = listed.ok ? listed.value.canvases[0] : undefined;
      expect(await learner.getMeta('openCanvases')).toEqual({ ok: true, value: [copy?.id] });
    });

    it('makes the strip of the copy alone when the strip that the learner had cannot be read', async () => {
      const { canvas, learner } = await opened({
        learner: (repository) => {
          const wrapped = { ...repository } as CanvasRepository;
          const read = repository.getMeta.bind(repository);
          wrapped.getMeta = (async (key: 'openCanvases' | 'lastOpenCanvas') =>
            key === 'openCanvases' ? { ok: false, error: broken } : read(key)) as CanvasRepository['getMeta'];
          return wrapped;
        },
      });
      await learner.setMeta('openCanvases', ['gone']);

      await canvas.saveCopy();

      const listed = await learner.list();
      const copy = listed.ok ? listed.value.canvases[0] : undefined;
      expect(await learner.getMeta('openCanvases')).toEqual({ ok: true, value: [copy?.id] });
    });

    it('then leaves the link, once, and does not give the button back, because the page is loaded again', async () => {
      const { canvas, leave } = await opened();

      await canvas.saveCopy();

      expect(leave).toHaveBeenCalledTimes(1);
      expect(canvas.saving()).toBe(true);
      expect(canvas.problem()).toBeNull();
    });

    it('makes one copy, however many times it is asked while it is being made', async () => {
      const { canvas, id, learner } = await opened();
      const { editor, finish } = editorOf(id);
      canvas.attach(editor);

      const first = canvas.saveCopy();
      const second = canvas.saveCopy();
      await settle();
      expect(canvas.saving()).toBe(true);
      finish();
      await Promise.all([first, second]);

      expect(await namesIn(learner)).toEqual(['Orders flow (shared)']);
    });

    it('does nothing before the canvas is in memory', async () => {
      const { canvas, learner, leave, made } = setup();

      await canvas.saveCopy();

      expect(made.browser).toBe(0);
      expect(await namesIn(learner)).toEqual([]);
      expect(leave).not.toHaveBeenCalled();
      expect(canvas.saving()).toBe(false);
    });

    describe('when it cannot be made', () => {
      const said = (rest: string) => `A copy could not be saved. ${rest}`;

      it('says that the browser keeps nothing, in the words of the storage, and makes no copy that would be gone with the tab', async () => {
        const { canvas, leave, learner } = await opened({
          learner: (repository) => failing(repository, { purgeExpired: unavailable }),
        });

        await canvas.saveCopy();

        expect(canvas.problem()).toBe(
          said(`${unavailable.message} A copy would be gone when this tab is closed, so none was made.`),
        );
        expect(await namesIn(learner)).toEqual([]);
        expect(leave).not.toHaveBeenCalled();
      });

      it('says that the browser could not list the canvases, with its words', async () => {
        const { canvas, leave } = await opened({ learner: (repository) => failing(repository, { list: broken }) });

        await canvas.saveCopy();

        expect(canvas.problem()).toBe(said(broken.message));
        expect(leave).not.toHaveBeenCalled();
      });

      it('says that the browser has no room, with its words, and leaves the learner where they are, with their work', async () => {
        const { canvas, leave, learner } = await opened({
          learner: (repository) => failing(repository, { create: full }),
        });

        await canvas.saveCopy();

        expect(canvas.problem()).toBe(said(full.message));
        expect(canvas.saving()).toBe(false);
        expect(canvas.ready()).toBe(true);
        expect(await namesIn(learner)).toEqual([]);
        expect(leave).not.toHaveBeenCalled();
      });

      it('says that the shared canvas could not be read, when the memory of the view cannot give it back', async () => {
        const { canvas, leave } = await opened({ view: (memory) => failing(memory, { get: broken }) });

        await canvas.saveCopy();

        expect(canvas.problem()).toBe(said(`The shared canvas could not be read. ${broken.message}`));
        expect(leave).not.toHaveBeenCalled();
      });

      it('can be tried again, and the problem of the last time is gone when it is', async () => {
        let refuse = true;
        const { canvas, leave, learner } = await opened({
          learner: (repository) => {
            const wrapped = { ...repository } as CanvasRepository;
            const create = repository.create.bind(repository);
            wrapped.create = async (canvasToMake) => (refuse ? { ok: false, error: full } : create(canvasToMake));
            return wrapped;
          },
        });
        await canvas.saveCopy();
        expect(canvas.problem()).toBe(said(full.message));

        refuse = false;
        const again = canvas.saveCopy();
        expect(canvas.problem()).toBeNull();
        await again;

        expect(await namesIn(learner)).toEqual(['Orders flow (shared)']);
        expect(leave).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('leaving', () => {
    it('takes the fragment off and loads the page, and asks nothing', async () => {
      const { canvas, leave, learner } = await opened();

      canvas.leave();

      expect(leave).toHaveBeenCalledTimes(1);
      expect(await namesIn(learner)).toEqual([]);
    });
  });
});
