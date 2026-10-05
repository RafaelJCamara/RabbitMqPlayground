import type { TestProject } from 'vitest/node';
import { detectContainerRuntime, type ContainerRuntime } from './container';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Whether the live run can happen here. Worked out once, before any test file is loaded. */
    conformanceRuntime: ContainerRuntime;
  }
}

/**
 * Decides, in the main process, whether Docker is usable, and says so on the terminal if it is not. A notice printed
 * from inside a skipped test file is swallowed by the reporter, and a silent skip is the thing to avoid.
 */
export default async function setup(project: TestProject): Promise<void> {
  const runtime: ContainerRuntime = process.env['CONFORMANCE_BROKER_HOST']
    ? { available: true }
    : await detectContainerRuntime();

  if (!runtime.available && process.env['CONFORMANCE_REQUIRED'] !== 'true') {
    console.warn(
      `\n⚠  The live conformance run is SKIPPED: ${runtime.reason}\n` +
        '   It needs Docker, and runs in CI (nightly.yml), where it is required.\n' +
        '   Set CONFORMANCE_REQUIRED=true to make a missing Docker an error here.\n',
    );
  }

  project.provide('conformanceRuntime', runtime);
}
