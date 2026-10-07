/**
 * The read-only handle that the `e2e` build puts on the window (projects/app/src/app/core/debug). What the editor knows is empty
 * or `null` until the editor has started.
 */
interface Window {
  readonly __rmq?: {
    readonly app: string;
    readonly flags: () => readonly string[];
    readonly document: () => unknown;
    readonly selection: () => { readonly nodes: readonly string[]; readonly edges: readonly string[] };
    readonly drawnEdges: () => readonly string[];
    readonly intents: () => readonly { readonly type: string; readonly [key: string]: unknown }[];
    readonly viewport: () => { readonly x: number; readonly y: number; readonly zoom: number } | null;
    /** What the overlay of the messages drew in its last frame. `null` without the overlay. */
    readonly overlayFrame: () => {
      readonly reducedMotion: boolean;
      readonly markers: readonly {
        readonly edge: string;
        readonly x: number;
        readonly y: number;
        readonly count: number;
        readonly key: string | null;
        readonly redelivered: boolean;
      }[];
    } | null;
    /** The simulation: the clock, whether it runs, how fast, when the next thing is, and the view of the engine. `null` without the flag. */
    readonly simulationState: () => {
      readonly now: number;
      readonly running: boolean;
      readonly speed: number;
      readonly nextAt: number | null;
      readonly view: {
        readonly now: number;
        readonly published: number;
        readonly travelling: number;
        readonly queues: Readonly<
          Record<
            string,
            {
              readonly ready: number;
              readonly unacked: number;
              readonly enqueued: number;
              readonly delivered: number;
              readonly consumers: number;
            }
          >
        >;
        readonly exchanges: Readonly<
          Record<string, { readonly routed: number; readonly unroutable: number; readonly refused: number }>
        >;
        readonly producers: Readonly<
          Record<string, { readonly published: number; readonly repeating: boolean; readonly nextAt: number | null }>
        >;
        readonly channels: Readonly<
          Record<
            string,
            {
              readonly received: number;
              readonly consumed: number;
              readonly waiting: number;
              readonly working: boolean;
              readonly prefetch: number;
            }
          >
        >;
      };
    } | null;
  };
}
