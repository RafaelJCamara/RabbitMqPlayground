export { BATCH_DOC, COMMAND_DOCS, renderCommandReference, type CommandDoc } from './lib/command-docs';
export { applyCommand } from './lib/commands/apply';
export { COLUMN_X, defaultPosition, ROW_HEIGHT, type ApplyContext, type IdKind } from './lib/commands/helpers';
export type {
  AddConsumer,
  AddProducer,
  AppCommand,
  Batch,
  BindCommand,
  CanvasChanges,
  Clear,
  Command,
  ConsumerChanges,
  DeclareExchange,
  DeclareQueue,
  Delete,
  DocumentCommand,
  ExchangeChanges,
  Help,
  Layout,
  Link,
  Move,
  MoveLabel,
  ProducerChanges,
  QueueChanges,
  Redo,
  Rename,
  SetCommand,
  Subscribe,
  UnbindCommand,
  Undo,
  Unlink,
  Unset,
  Unsubscribe,
} from './lib/commands/types';
export {
  canvasFullIssue,
  edgeCount,
  elementCount,
  noRoomForEdge,
  noRoomForElement,
  payloadIssue,
} from './lib/document/capacity';
export { COLLECTION, elements, findId, kindOf, lookup, nameOf, recordOf, type Element } from './lib/document/elements';
export {
  bindingHeadersIssue,
  bindingSignature,
  canonicalHeaders,
  headerKeyIssue,
  HEADER_KEY_MAX_BYTES,
  headerValueProblem,
  messageHeadersIssue,
  X_MATCH,
} from './lib/document/headers';
export {
  ELEMENT_KINDS,
  fail,
  KIND_LABEL,
  ok,
  type ElementKind,
  type ElementRef,
  type Issue,
  type IssueKind,
  type Result,
} from './lib/document/issue';
export { hasReservedPrefix, NAME_MAX_BYTES, nameIssue, type NameOptions } from './lib/document/names';
export {
  defaultExchangeIssue,
  duplicateNameIssue,
  internalExchangeIssue,
  missingEndIssue,
  reservedNameIssue,
  topicKeyIssue,
  transientQueueIssue,
} from './lib/document/rules';
export {
  canvasDocumentSchema,
  DEFAULT_SEED,
  DEFAULT_TIMING,
  EDGE_KEY_PATTERN,
  emptyDocument,
  ID_PATTERN,
  LIMITS,
  type BindingRecord,
  type CanvasDocument,
  type ConsumerRecord,
  type ExchangeRecord,
  type Id,
  type NewDocumentOptions,
  type Position,
  type ProducerRecord,
  type QueueRecord,
} from './lib/document/schema';
export { edgeKey, edgeKeys, toTopology } from './lib/document/topology';
export { History, HISTORY_LIMIT } from './lib/history';
export { autoLayout, COLUMN_SEPARATION, NODE_SEPARATION, NODE_SIZE } from './lib/layout';
export {
  allowedTargets,
  explainLink,
  linkCommand,
  linkRules,
  linkVerdict,
  type LinkRules,
  type LinkVerdict,
} from './lib/link-rules';
export { lint, type Lint, type LintKind } from './lib/lints';
export { reconcile } from './lib/reconcile';
export { editDistance, suggest } from './lib/suggest';
export { completeCommand, type Completion, type CompletionItem } from './lib/syntax/complete';
export { formatCommand } from './lib/syntax/format';
export { parseCommand } from './lib/syntax/parse';
export { SPECS } from './lib/syntax/registry';
export { wordText } from './lib/syntax/words';
export type { CommandSpec } from './lib/syntax/spec';
export { parseDocument, validateDocument, type ParsedDocument } from './lib/document/validate';
