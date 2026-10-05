import type { Scenario } from '../scenario';
import { DELIVERY_SCENARIOS } from './delivery';
import { HEADERS_SCENARIOS } from './headers';
import { LIMIT_SCENARIOS } from './limits';
import { REFUSAL_SCENARIOS } from './refusals';
import { ROUTING_SCENARIOS } from './routing';
import { TOPIC_SCENARIOS } from './topic';

/** Every scenario that `record` plays and turns into a fixture. */
export const SCENARIOS: readonly Scenario[] = [
  ...ROUTING_SCENARIOS,
  ...REFUSAL_SCENARIOS,
  ...LIMIT_SCENARIOS,
  ...TOPIC_SCENARIOS,
  ...HEADERS_SCENARIOS,
  ...DELIVERY_SCENARIOS,
];
