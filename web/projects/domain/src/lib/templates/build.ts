import { applyCommand } from '../commands/apply';
import type { ApplyContext, IdKind } from '../commands/helpers';
import { isDocumentCommand } from '../commands/kinds';
import { emptyDocument, type CanvasDocument } from '../document/schema';
import { parseCommand } from '../syntax/parse';
import type { Template } from './templates';

const LETTER: Readonly<Record<IdKind, string>> = {
  exchange: 'x',
  queue: 'q',
  producer: 'p',
  consumer: 'c',
  binding: 'b',
};

/** Ids that count up from 1 for each kind of thing (`x1`, `q2`, `b3`), so that a template makes the same canvas every time it is made. */
function counting(): ApplyContext {
  const counters = new Map<IdKind, number>();
  return {
    newId(kind) {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${LETTER[kind]}${next}`;
    },
  };
}

/**
 * The canvas that a template's commands make, on an empty canvas, by the parser and the commands that anything typed goes through (ADR-0081). A line that is not read, is not a command that changes
 * the canvas, or is refused is a mistake in the template and not in whoever asked for it, so it throws, saying which template and which line and why: the specs make every template, so none ships that does.
 */
export function buildTemplate(template: Template): CanvasDocument {
  const context = counting();
  let document = emptyDocument();
  template.script.forEach((line, index) => {
    const where = `The template “${template.name}”, line ${index + 1} (${line})`;
    const read = parseCommand(line, document);
    if (!read.ok) {
      throw new Error(`${where}, was not read: ${read.error.message}`);
    }
    if (!isDocumentCommand(read.value)) {
      throw new Error(`${where}, is not a command that changes the canvas`);
    }
    const result = applyCommand(document, read.value, context);
    if (!result.ok) {
      throw new Error(`${where}, was refused: ${result.error.message}`);
    }
    document = result.value;
  });
  return document;
}
