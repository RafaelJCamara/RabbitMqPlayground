export { COMMAND_DOCS, renderCommandReference, type CommandDoc } from './lib/command-docs';
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
  ok,
  type ElementKind,
  type ElementRef,
  type Issue,
  type IssueKind,
  type Result,
} from './lib/document/issue';
export { hasReservedPrefix, KIND_LABEL, NAME_MAX_BYTES, nameIssue, type NameOptions } from './lib/document/names';
export {
  duplicateNameIssue,
  internalExchangeIssue,
  missingEndIssue,
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
export { parseDocument, validateDocument, type ParsedDocument } from './lib/document/validate';
