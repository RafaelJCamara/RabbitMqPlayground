import type { Scenario } from '../scenario';
import { CHAIN_SCENARIOS } from './chains';
import { DELIVERY_SCENARIOS } from './delivery';
import { EXCHANGE_SCENARIOS } from './exchanges';
import { HEADERS_SCENARIOS } from './headers';
import { LIMIT_SCENARIOS } from './limits';
import { RANDOM_SCENARIOS } from './random';
import { REFUSAL_SCENARIOS } from './refusals';
import { ROUTING_SCENARIOS } from './routing';
import { TOPIC_SCENARIOS } from './topic';

/** Every scenario that `record` plays and turns into a fixture. */
export const SCENARIOS: readonly Scenario[] = [
  ...ROUTING_SCENARIOS,
  ...EXCHANGE_SCENARIOS,
  ...CHAIN_SCENARIOS,
  ...REFUSAL_SCENARIOS,
  ...LIMIT_SCENARIOS,
  ...TOPIC_SCENARIOS,
  ...HEADERS_SCENARIOS,
  ...RANDOM_SCENARIOS,
  ...DELIVERY_SCENARIOS,
];
