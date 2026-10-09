import type { Provider } from '@angular/core';
import { FrameLoop } from './frame-loop';
import { SimStats } from './sim-stats';
import { Simulation } from './simulation';

/**
 * What the simulation is made of, which the editor provides and a spec that builds a part of the editor provides too.
 */
export const RUNTIME_SERVICES: Provider[] = [FrameLoop, SimStats, Simulation];
