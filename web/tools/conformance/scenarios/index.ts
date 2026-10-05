import type { Scenario } from '../scenario';
import { DELIVERY_SCENARIOS } from './delivery';
import { LIMIT_SCENARIOS } from './limits';
import { REFUSAL_SCENARIOS } from './refusals';
import { ROUTING_SCENARIOS } from './routing';

/** Every scenario that `record` plays and turns into a fixture. */
export const SCENARIOS: readonly Scenario[] = [
  ...ROUTING_SCENARIOS,
  ...REFUSAL_SCENARIOS,
  ...LIMIT_SCENARIOS,
  ...DELIVERY_SCENARIOS,
];
