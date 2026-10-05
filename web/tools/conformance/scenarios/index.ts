import type { Scenario } from '../scenario';
import { DELIVERY_SCENARIOS } from './delivery';
import { ROUTING_SCENARIOS } from './routing';

/** Every scenario that `record` plays and turns into a fixture. */
export const SCENARIOS: readonly Scenario[] = [...ROUTING_SCENARIOS, ...DELIVERY_SCENARIOS];
