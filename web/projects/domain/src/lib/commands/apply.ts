import { fail, ok, type Result } from '../document/issue';
import type { CanvasDocument } from '../document/schema';
import { applyBind, applyUnbind } from './bind';
import { applyAddConsumer, applyAddProducer, applyDeclareExchange, applyDeclareQueue } from './declare';
import type { ApplyContext } from './helpers';
import { applyLink, applySubscribe, applyUnlink, applyUnsubscribe } from './links';
import { applyLayout, applyMove, applyMoveLabel } from './place';
import { applySet, applyUnset } from './set';
import { applyClear, applyDelete, applyRename } from './structure';
import type { Batch, DocumentCommand } from './types';

/**
 * The one way that a canvas changes (ADR-0011, ADR-0019). `applyCommand` returns the document that the command makes, or
 * the reason that it refuses, and never changes the document it is given. The branches of the document that the command
 * did not touch are the same objects in the new one, and a command that would change nothing returns the document it was
 * given, so that "did anything change?" is a comparison of references.
 */

function applyBatch(document: CanvasDocument, batch: Batch, context: ApplyContext): Result<CanvasDocument> {
  if (batch.commands.length === 0) {
    return fail({ kind: 'batch', message: 'A batch needs at least one command.' });
  }
  let current = document;
  for (const [index, command] of batch.commands.entries()) {
    const result = applyCommand(current, command, context);
    if (!result.ok) {
      return fail({ ...result.error, batchIndex: index });
    }
    current = result.value;
  }
  return ok(current);
}

/**
 * Applies a command to a document. A batch is one change: each command is applied to what the one before it made, and if
 * any of them is refused the whole batch is, and says which, so that drag-to-create is one step of undo.
 */
export function applyCommand(
  document: CanvasDocument,
  command: DocumentCommand,
  context: ApplyContext,
): Result<CanvasDocument> {
  switch (command.type) {
    case 'declare-exchange':
      return applyDeclareExchange(document, command, context);
    case 'declare-queue':
      return applyDeclareQueue(document, command, context);
    case 'add-producer':
      return applyAddProducer(document, command, context);
    case 'add-consumer':
      return applyAddConsumer(document, command, context);
    case 'bind':
      return applyBind(document, command, context);
    case 'unbind':
      return applyUnbind(document, command);
    case 'link':
      return applyLink(document, command);
    case 'unlink':
      return applyUnlink(document, command);
    case 'subscribe':
      return applySubscribe(document, command);
    case 'unsubscribe':
      return applyUnsubscribe(document, command);
    case 'set':
      return applySet(document, command);
    case 'unset':
      return applyUnset(document, command);
    case 'move':
      return applyMove(document, command);
    case 'move-label':
      return applyMoveLabel(document, command);
    case 'rename':
      return applyRename(document, command);
    case 'delete':
      return applyDelete(document, command);
    case 'clear':
      return applyClear(document, command);
    case 'layout':
      return applyLayout(document, command);
    case 'batch':
      return applyBatch(document, command, context);
  }
}
