/**
 * Vitest setup file for the library and tool projects (see vitest.config.ts).
 * It is not exported from the library: a test run applies it, nothing imports it.
 */
import { configureFastCheck } from './lib/fast-check';

configureFastCheck(process.env);
