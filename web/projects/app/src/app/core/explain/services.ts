import type { Provider } from '@angular/core';
import { ConsumerInbox } from './consumer-inbox';
import { EventLog } from './event-log';
import { ExplainState } from './explain-state';
import { WhatIf } from './what-if';

/**
 * What the explanation is made of (ADR-0061, ADR-0062, ADR-0064, ADR-0098): the log, which listens from the moment that the editor opens, what each consumer was given, which listens from the same moment, the what-if
 * tester, and what the learner chose. The editor provides them, and a spec that builds a part of the editor that reads them provides them too.
 */
export const EXPLAIN_SERVICES: Provider[] = [EventLog, ConsumerInbox, WhatIf, ExplainState];
