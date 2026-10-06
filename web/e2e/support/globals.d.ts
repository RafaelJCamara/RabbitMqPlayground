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
  };
}
