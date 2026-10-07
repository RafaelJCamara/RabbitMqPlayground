import type { Provider } from '@angular/core';
import { EventLog } from './event-log';
import { ExplainState } from './explain-state';

/**
 * What the explanation is made of (ADR-0061, ADR-0062): the log, which listens from the moment that the editor opens, and what the learner chose. The editor provides them, and a spec that builds a part of the
 * editor that reads them provides them too. Both need the flags `explain` and `simulation`, and do nothing without them, so a part that has no use for them pays nothing for having them.
 */
export const EXPLAIN_SERVICES: Provider[] = [EventLog, ExplainState];
