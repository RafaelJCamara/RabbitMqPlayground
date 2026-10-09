/**
 * The read-only handle that the `e2e` build puts on the window (projects/app/src/app/core/debug). What the editor knows is empty
 * or `null` until the editor has started.
 */
interface Window {
  readonly __rmq?: {
    readonly app: string;
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
        /** The number of the message that it stands for, or `null` for a crowd. */
        readonly message: number | null;
      }[];
    } | null;
    /** The rows of the event log, as they were said: how many are kept, how many went, and each row. `null` without the flags `explain` and `simulation`. */
    readonly explainEventLog: () => {
      readonly count: number;
      readonly dropped: number;
      readonly rows: readonly {
        readonly seq: number;
        readonly at: number;
        readonly family: string;
        readonly kind: string;
        readonly text: string;
        readonly message: number | null;
      }[];
    } | null;
    /** What Why? lights, as marks of the edges and the nodes, and what its card says. `null` when nothing is lit. */
    readonly explainEmphasis: () => {
      readonly source: 'row' | 'why' | 'queue' | 'auto' | 'what-if';
      readonly message: number | null;
      readonly title: string;
      readonly text: string;
      readonly edges: readonly { readonly key: string; readonly mark: string; readonly reason?: string }[];
      readonly nodes: readonly { readonly id: string; readonly mark: string }[];
      readonly gone: number;
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
