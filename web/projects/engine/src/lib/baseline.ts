/**
 * The RabbitMQ version line the simulator follows (ADR-0008). Every saved canvas records it, and the conformance
 * fixtures are recorded against it. Moving to a new baseline needs a new ADR and regenerated fixtures.
 */
export const RABBITMQ_BASELINE = '4.3';

export type RabbitMqBaseline = typeof RABBITMQ_BASELINE;
