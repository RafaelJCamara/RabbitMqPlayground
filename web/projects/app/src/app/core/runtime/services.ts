import type { Provider } from '@angular/core';
import { FrameLoop } from './frame-loop';
import { SimStats } from './sim-stats';
import { Simulation } from './simulation';

/**
 * What the simulation is made of, which the editor provides and a spec that builds a part of the editor provides too. The simulation does nothing without the
 * flag `simulation`, so a part that has no use for it pays nothing for having it.
 */
export const RUNTIME_SERVICES: Provider[] = [FrameLoop, SimStats, Simulation];
