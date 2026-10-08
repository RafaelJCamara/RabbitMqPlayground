import type { CanvasDocument } from '@rmq/domain';
import type { LoadError, RepositoryError } from '../errors';
import { SIZE_CAPS } from '../load/caps';
import { failure, succeed, type Outcome } from '../outcome';
import type { CanvasRecord } from '../record';
import type { CanvasRepository } from '../repository/repository';
import type { Backup, BackupEntry } from './backup';

/**
 * Putting a backup back (ADR-0075). ADR-0027 left to the app "what to do with an id that is taken". The answer is that a backup never
 * writes over a canvas: a canvas of the file whose id is free is put back as it was, one that is already here is left alone, and one whose
 * id is taken by a canvas that is different is made as a new canvas under a new id. What is decided is a pure function of the file and of
 * what the repository holds, `planRestore`, so that every case is a row of a table, and what is done is a loop over the plan, `restoreBackup`.
 */

/** Two values are the same when they hold the same: objects by their keys and not by the order of them, lists by their order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item: unknown, index) => sameValue(item, b[index]))
    );
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}

const RESTORED = ' (restored)';

/** Cuts a name to `max` characters without leaving half of a pair of code units that make one character. */
function cut(name: string, max: number): string {
  if (name.length <= max) {
    return name;
  }
  const end = name.charCodeAt(max - 1) >= 0xd800 && name.charCodeAt(max - 1) <= 0xdbff ? max - 1 : max;
  return name.slice(0, end);
}

/** The name of a canvas that is made from one of a backup whose id was taken: "Orders (restored)", cut so that the whole stays inside the cap. */
export const restoredName = (name: string): string => `${cut(name, SIZE_CAPS.name - RESTORED.length)}${RESTORED}`;

/** What is done with one canvas of a backup. */
export type RestoreStep =
  /** The id is free: it is put back exactly as the file has it, with its id, its times and its document. */
  | { readonly kind: 'put'; readonly record: CanvasRecord }
  /** The same canvas is here already: the same id, the same name and the same document. Nothing is written. */
  | { readonly kind: 'skip'; readonly record: CanvasRecord }
  /** The id is taken by something else: a new canvas is made with a new id. */
  | { readonly kind: 'copy'; readonly name: string; readonly document: CanvasDocument; readonly of: CanvasRecord }
  /** The file has a canvas here that cannot be read. Nothing is written, and the others go on. */
  | { readonly kind: 'unreadable'; readonly position: number; readonly name?: string; readonly error: LoadError };

/** What the repository holds that a restore must not write over. */
export interface RestoreHeld {
  /** The canvases that are not deleted and can be read. */
  readonly canvases: readonly CanvasRecord[];
  /** The ids of the ones that are not deleted and cannot be read: they may be what a newer version of the app wrote, and are never written over. */
  readonly unreadableIds: readonly string[];
}

/** What to do with each canvas of a backup, in the order of the file. */
export function planRestore(entries: readonly BackupEntry[], held: RestoreHeld): RestoreStep[] {
  const here = new Map(held.canvases.map((canvas) => [canvas.id, canvas]));
  const unreadable = new Set(held.unreadableIds);
  return entries.map((entry): RestoreStep => {
    if (!entry.ok) {
      return {
        kind: 'unreadable',
        position: entry.position,
        ...(entry.name === undefined ? {} : { name: entry.name }),
        error: entry.error,
      };
    }
    const { canvas } = entry;
    const same = here.get(canvas.id);
    if (same !== undefined && same.name === canvas.name && sameValue(same.document, canvas.document)) {
      return { kind: 'skip', record: canvas };
    }
    if (same !== undefined || unreadable.has(canvas.id)) {
      return { kind: 'copy', name: restoredName(canvas.name), document: canvas.document, of: canvas };
    }
    return { kind: 'put', record: canvas };
  });
}

/** A canvas as the report names it. */
export interface Restored {
  readonly id: string;
  readonly name: string;
}

/** What a restore did, for the dialog that says it and for the learner who reads it. */
export interface RestoreReport {
  /** Put back as the file had them. */
  readonly restored: readonly Restored[];
  /** Left alone, because the same canvas was here. */
  readonly alreadyHere: readonly Restored[];
  /** Made as new canvases, because their ids were taken: `id` and `name` are the new canvas's, `of` is the name the file had. */
  readonly copies: readonly (Restored & { readonly of: string })[];
  /** Canvases of the file that could not be read, where they were in it (counting from 1) and why. */
  readonly unreadable: readonly { readonly position: number; readonly name?: string; readonly message: string }[];
  /** Canvases that could not be written, other than for lack of room, and why. */
  readonly failed: readonly { readonly name: string; readonly message: string }[];
  /** The browser ran out of room, which stops the restore because the next write would fail too: what the browser said, and how many canvases were not put back (the one that was refused and the ones after it). */
  readonly outOfRoom?: { readonly message: string; readonly notPutBack: number };
}

/**
 * Puts a backup back, by the plan. The repository is read once, for what it holds, and then each canvas is written on its own, so that one
 * that cannot be written does not stop the others, except for lack of room, which stops all of them. It fails only if the repository cannot be read.
 */
export async function restoreBackup(
  repository: CanvasRepository,
  backup: Backup,
): Promise<Outcome<RestoreReport, RepositoryError>> {
  const listed = await repository.list();
  if (!listed.ok) {
    return failure(listed.error);
  }
  const plan = planRestore(backup.entries, {
    canvases: listed.value.canvases,
    unreadableIds: listed.value.unreadable.map(({ id }) => id),
  });

  const restored: Restored[] = [];
  const alreadyHere: Restored[] = [];
  const copies: (Restored & { of: string })[] = [];
  const unreadable: { position: number; name?: string; message: string }[] = [];
  const failed: { name: string; message: string }[] = [];
  let outOfRoom: { message: string; notPutBack: number } | undefined;

  for (const [index, step] of plan.entries()) {
    if (step.kind === 'unreadable') {
      unreadable.push({
        position: step.position + 1,
        ...(step.name === undefined ? {} : { name: step.name }),
        message: step.error.message,
      });
    } else if (step.kind === 'skip') {
      alreadyHere.push({ id: step.record.id, name: step.record.name });
    } else {
      const written =
        step.kind === 'put'
          ? await repository.put(step.record)
          : await repository.create({ name: step.name, document: step.document });
      const name = step.kind === 'put' ? step.record.name : step.name;
      if (written.ok) {
        if (step.kind === 'put') {
          restored.push({ id: written.value.id, name });
        } else {
          copies.push({ id: written.value.id, name, of: step.of.name });
        }
      } else if (written.error.kind === 'quota-exceeded') {
        const after = plan.slice(index + 1).filter((later) => later.kind === 'put' || later.kind === 'copy').length;
        outOfRoom = { message: written.error.message, notPutBack: 1 + after };
        break;
      } else {
        failed.push({ name, message: written.error.message });
      }
    }
  }

  return succeed({
    restored,
    alreadyHere,
    copies,
    unreadable,
    failed,
    ...(outOfRoom === undefined ? {} : { outOfRoom }),
  });
}
