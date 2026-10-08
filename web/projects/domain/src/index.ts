export { BATCH_DOC, COMMAND_DOCS, renderCommandReference, type CommandDoc } from './lib/command-docs';
export { applyCommand } from './lib/commands/apply';
export { isDocumentCommand, isRuntimeCommand } from './lib/commands/kinds';
export { runtimeIssue } from './lib/commands/runtime';
export type {
  ClearMessages,
  Pause,
  Play,
  Publish,
  Purge,
  ResetCounters,
  RuntimeCommand,
  Speed,
  Step,
} from './lib/commands/types';
export { SPEED_RANGE, SPEEDS } from './lib/syntax/specs/runtime';
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
  Share,
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
  duplicateHeaderIssue,
  headerKeyIssue,
  HEADER_KEY_MAX_BYTES,
  headerValueProblem,
  messageHeadersIssue,
  reservedHeaderIssue,
  sameHeaders,
  tooManyEntriesIssue,
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
export { bindingIds, edgeKey, edgeKeys, exchangesLeadingTo, toTopology } from './lib/document/topology';
export {
  draftFromMessage,
  draftOf,
  EMPTY_ROW,
  isBlank,
  newDraft,
  problemAt,
  reportDraft,
  reportMessageRows,
  retypeRow,
  rowsOf,
  rowType,
  sameEntries,
  withText,
  type DraftReport,
  type DraftRow,
  type HeadersDraft,
  type MessageReport,
  type RowReport,
  type RowType,
} from './lib/headers/draft';
export { describeHeaders, type ConditionLine } from './lib/explain/headers-words';
export {
  headersLine,
  headersTable,
  type CellWord,
  type HeadersTable,
  type TableCell,
  type TableColumn,
  type TableMessage,
  type TableRow,
} from './lib/explain/headers-table';
export { explainQueue } from './lib/explain/queue';
export { explainRoute, isRouted, messageIssue, outlookOf, refusalText, summaryOf } from './lib/explain/route';
export { alignmentLines, explanationHeader, explanationText } from './lib/explain/text';
export { topicWords, type TopicWords } from './lib/explain/topic-words';
export { testTopicKey, type TopicSample, type TopicTest } from './lib/explain/topic-test';
export type {
  BindingDetail,
  BindingNode,
  ExchangeNode,
  InvalidExplanation,
  QueueExplanation,
  ReasonNode,
  RefusedExplanation,
  RoutedExplanation,
  RouteExplanation,
} from './lib/explain/types';
export { SHORT_MOST, typeText, valueText } from './lib/explain/words';
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
export { headersLint, lint, type Lint, type LintKind } from './lib/lints';
export { reconcile } from './lib/reconcile';
export { editDistance, suggest } from './lib/suggest';
export { completeCommand, type Completion, type CompletionItem } from './lib/syntax/complete';
export { formatCommand } from './lib/syntax/format';
export { parseMessageText, type MessageText } from './lib/syntax/message';
export { parseCommand } from './lib/syntax/parse';
export { SPECS } from './lib/syntax/registry';
export { BINDING_OPTION_NAMES } from './lib/syntax/specs/bind';
export {
  formatCondition,
  formatValue,
  inferValue,
  needsValueOf,
  readType,
  retypeValue,
  VALUE_TYPES,
  type ValueType,
} from './lib/syntax/values';
export { wordText } from './lib/syntax/words';
export type { CommandSpec } from './lib/syntax/spec';
export { parseDocument, validateDocument, type ParsedDocument } from './lib/document/validate';
export { readSnapshot, snapshotDisagrees, type SnapshotRead } from './lib/snapshot';
export { buildTemplate } from './lib/templates/build';
export { TEMPLATES, templateById, type Template, type TemplateId } from './lib/templates/templates';
