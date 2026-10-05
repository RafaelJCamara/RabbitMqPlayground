# Foblex Flow integration notes (from the ADR-0016 spike)

These are reference notes for **S4** (the editor core and Foblex adapter), and for the E2E and performance harness work in
**S0, S6 and S12**. They come from the throwaway spike that settled
[ADR-0016](../adr/0016-node-editor-library.md), built on **Foblex Flow 19.3.0, Angular 22.2 (zoneless) and Node 24**.

This is not production code. Re-implement it inside `web/projects/app/src/app/canvas/flow/**`, following ADR-0016,
[ADR-0017](../adr/0017-canvas-keyboard-model.md) and §2.4 of the [M1 plan](m1.md).

## 1. Providers

```ts
// The spike had the keyboard layer off by default (withA11y({ keyboard: false }); on with ?a11y).
// ADR-0017 turns it on, with our keys:
providers: [
  provideFFlow(
    withA11y({ keys: { connect: ['l'], grab: ['m'] }, messages: { /* our wording */ } }),
    withConnectionFlow('click'), // click-to-connect alongside drag. Documented in AI.md, NOT tried in the spike
  ),
],
// The spike ran the root component with ViewEncapsulation.None, because the theme styles library internals.
// Put the theme in a global stylesheet instead (§4).
```

## 2. Template skeleton

**Nodes and connections must be *direct* children of `<f-canvas>`.** The library's layer sorting compares
`parentElement` with its layer containers. If you wrap them in a component host element, every pointerdown throws
`Error: Unknown container`, with no FF diagnostic code. Only `<ng-container ngProjectAs>` wrappers work.

```html
<f-flow fDraggable
        (fCreateConnection)="onCreateConnection($event)"
        (fMoveNodes)="onMoveNodes($event)"
        (fDragStarted)="onDragStarted($event)"
        (fDragEnded)="endDrag()">
  <f-canvas fZoom [position]="viewPosition()" [scale]="viewScale()">
    @for (e of edges(); track e.id) {
      <!-- data-edge marks the element; data-edge-id is added once the path has been drawn (§3.6) -->
      <f-connection [attr.data-edge]="e.id" [fConnectionId]="e.id"
                    [fSourceId]="outId(e.source)" [fTargetId]="inId(e.target)"
                    fType="bezier" fBehavior="fixed" [fReassignDisabled]="true">
        <f-connection-marker-arrow />
        @if (e.chips.length) {
          <div fConnectionContent class="chips">   <!-- position defaults to 0.5, centred -->
            @for (chip of e.chips; track $index) { <span class="chip">{{ chip }}</span> }
          </div>
        }
      </f-connection>
    }
    <f-connection-for-create fType="bezier"><f-connection-marker-arrow /></f-connection-for-create>

    @for (n of nodes(); track n.id) {
      <!-- The app owns this element: exact size, our classes, our aria-label. No tabindex (ADR-0017). -->
      <div fNode fDragHandle [fNodeId]="n.id" [fNodePosition]="{ x: n.x, y: n.y }" [attr.data-node-id]="n.id">
        …node content (may be our own components)…
        @if (hasInput(n.kind)) {
          <div fConnector fConnectorType="target" [fConnectorId]="inId(n.id)"
               fConnectorConnectableSide="left" data-handle="in"></div>
        }
        @if (hasOutput(n.kind)) {
          <div fConnector fConnectorType="source" [fConnectorId]="outId(n.id)"
               fConnectorConnectableSide="right" [fCanBeConnectedTo]="allowedTargets(n.id)"
               data-handle="out"></div>
        }
      </div>
    }
  </f-canvas>
  <f-minimap />   <!-- its size and position come from the theme's plugins() mixin; without it, it is 0×0 -->
</f-flow>
```

Foblex sets `.f-node { position:absolute !important; left:0 !important; top:0 !important }` and positions nodes with
an inline `transform`. With the spike's CSS, the app-owned element was exactly the node box (0 px error).

## 3. Adapter pieces that worked

```ts
const inId = (nodeId: string) => `in:${nodeId}`;
const outId = (nodeId: string) => `out:${nodeId}`;
const nodeIdOf = (connectorId: string) => connectorId.slice(connectorId.indexOf(':') + 1);

/** fCanBeConnectedTo treats [] as "no restriction"; "nothing is connectable" needs an unused id. */
const NOTHING = ['∅'];
```

### 3.1 Validation: arming the allow-list (workaround 2)

Foblex has no validator callback. The source connector's `fCanBeConnectedTo` is read **once**, when the drag session
starts at the 3 px threshold. `fDragStarted` fires *after* the targets have been collected, so it is too late to
prepare them there. Filling the list for every source cost ~60–70 ms per topology change on 200 nodes / 500 edges,
so the adapter fills it only for the source being pressed:

```ts
private readonly armedSource = signal<string | null>(null);
private readonly armedTargets = computed(() => {
  const source = this.armedSource();
  if (!source) return NOTHING;
  const ids = nodes().filter((t) => hasInput(t.kind) && rules.check(source, t.id).ok).map((t) => inId(t.id));
  return ids.length ? ids : NOTHING;
});
allowedTargets(nodeId: string) { return this.armedSource() === nodeId ? this.armedTargets() : NOTHING; }

// The capture-phase pointerdown runs before the library's mousedown/touchstart handlers.
private readonly armOnPointerDown = (event: PointerEvent) => {
  const nodeId = (event.target as Element | null)?.closest?.('[data-handle="out"]')
    ?.closest('[data-node-id]')?.getAttribute('data-node-id');
  if (nodeId) this.arm(nodeId);
};
private arm(nodeId: string) {
  this.armedSource.set(nodeId);
  this.cdr.detectChanges(); // push the allow-list into the connector input now (~3.5–4 ms on 200/500)
}
// Keyboard linking (L) starts from the single selected node, so also arm it when the selection changes:
draggable.fSelectionChange.subscribe(({ nodeIds, connectionIds }) => {
  if (nodeIds.length === 1 && !connectionIds.length) this.arm(nodeIds[0]);
});
```

### 3.2 Drag start, and classifying a drop

```ts
onDragStarted(event: FDragStartedEvent) {
  const source = (event.data as { fOutputOrOutletId?: string } | undefined)?.fOutputOrOutletId;
  if (event.kind === 'create-connection' && source) startDrag(nodeIdOf(source)); // highlight valid targets
}

onCreateConnection(event: FCreateConnectionEvent) {
  const sourceId = nodeIdOf(event.sourceId);
  if (event.targetId) { link(sourceId, nodeIdOf(event.targetId)); return; }
  // An invalid target and empty canvas both arrive as "no target", so hit-test the drop point.
  const { x, y } = event.dropPosition; // client px
  const targetId = nodeAt(x, y);
  targetId ? rejectLink(sourceId, targetId) : openCreateMenu(sourceId, x - hostRect.left, y - hostRect.top);
}

nodeAt(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = host.contains(el) ? el.closest('[data-node-id]')?.getAttribute('data-node-id') : null;
    if (id) return id;
  }
  return null;
}
```

`fConnectOnNode` defaults to true, so a drop anywhere on a **valid** node links it.

### 3.3 Node moves are reported only when a drag ends

```ts
onMoveNodes(event: FMoveNodesEvent) {
  for (const { id, position } of event.nodes) if (position) moveNode(id, position.x, position.y);
}
```

### 3.4 Live viewport (workaround 1)

- `(fCanvasChange)` fires only when a gesture ends, and always goes through `setTimeout`, even with a debounce of 0.
- `getPosition()` leaves out the zoom offset.

So read the canvas model directly, which gives the same sum `getState()` reports:

```ts
liveTransform() {
  const t = canvas.transform; // public in the typings, undocumented
  return { x: t.position.x + t.scaledPosition.x, y: t.position.y + t.scaledPosition.y, zoom: t.scale };
}
// screen position relative to the host = flow * zoom + (x, y). This measured 0 px drift at paint.
```

### 3.5 Setting the viewport through the one-way `[position]` / `[scale]` inputs

The user's pan and zoom don't update these inputs, and Angular ignores re-binding an equal number. So re-applying a zoom
that is already bound would be dropped:

```ts
setTransform(t: { x: number; y: number; zoom: number }) {
  if (t.zoom === canvas.scale() && t.zoom !== canvas.transform.scale) {
    this.viewScale.set(canvas.transform.scale); // bind the live zoom first…
    this.cdr.detectChanges();
  }
  this.viewPosition.set({ x: t.x, y: t.y });    // a new object each time
  this.viewScale.set(t.zoom);                   // …then the requested one. Applied on the next change detection.
}
fitView() { canvas.fitToScreen({ x: 40, y: 40 }, false); }
```

### 3.6 Detecting drawn edges, and reading their geometry

Connection geometry is computed asynchronously:
- a 1 ms debounce;
- a round trip to a lazily created Web Worker, from a Blob URL (so the CSP needs `worker-src blob:`);
- then rAF slices of up to 6 ms.

An `<f-connection>` therefore exists before its path does. On a cold start the demo edges were drawn about 38 ms after
their elements appeared.

```ts
new MutationObserver((records) => {
  for (const { target } of records) {
    const path = target as Element;
    const edge = path.classList.contains('f-connection-path') ? path.closest('f-connection') : null;
    const id = edge?.getAttribute('data-edge');
    if (edge && id && !edge.hasAttribute('data-edge-id')) edge.setAttribute('data-edge-id', id); // drawn
  }
}).observe(canvas.fConnectionsContainer().nativeElement, { subtree: true, attributes: true, attributeFilter: ['d'] });

edgePath(id: string) { // flow coordinates; null until the edge is drawn
  return host.querySelector(`[data-edge="${CSS.escape(id)}"] path.f-connection-path`)?.getAttribute('d') ?? null;
}
```

## 4. Theme (global SCSS)

```scss
@use '@foblex/flow/styles' as flow-theme;
@include flow-theme.theme-tokens();
@include flow-theme.flow-canvas();
@include flow-theme.connection-all();
@include flow-theme.plugins();
// node-group() and connector() were left out: their `f-flow .f-node { width: var(--ff-node-width); padding: 24px; … }`
// and connector-socket rules out-rank app styles and would change the node box and handle look.

// Handles centred on the left/right border at mid-height (12px dot + 2px border = 16px).
.node > [data-handle] { position: absolute; top: 50%; transform: translateY(-50%); }
.node > [data-handle='in'] { left: -9px; }
.node > [data-handle='out'] { right: -9px; cursor: crosshair; }
// WCAG 2.5.8 (ADR-0017): give handles a hit area of at least 24×24 even though the visible dot is smaller.

// Our chips: drop the theme's single-label pill around the group.
f-flow .f-connection-content.chips { padding: 0; border: 0; background: none; }
```

As a component stylesheet the theme hit the 16 kB `anyComponentStyle` budget (19.6 kB, 13 kB of it CSS custom
properties). Make it global, and keep Tailwind 4 and Sass in separate files.

## 5. Gotchas observed

- **Layer raise on click.** Clicking a node moves its element to the end of the nodes container. Harmless, but it does
  reorder DOM that Angular manages.
- **Re-checks.** Because the loops can't be split into child components, any binding change in the flow template
  re-checks about 1,000 node, edge and chip views (2–3 ms on 200/500). Keep counters in per-node signals, not in that
  template.
- **Compositor layers.** Connection labels are placed with `translate3d`, which created 137 layers for 171 label groups
  on 200/500. That is likely part of the cost of programmatic zoom animation (46 fps vs ngx-vflow's 58).
- **`fFullRendered`** fires once per lifecycle; only `flow.reset()` re-arms it.
- **Accessible names are poor by default:** "order-eventsqueue" for nodes, and "Connection from out:x1 to in:q1" for
  connections. Set our own `aria-label`; Foblex keeps labels the app set.
- **Keyboard layer:**
  - it uses one tab stop with `aria-activedescendant`, so nodes must not be tab stops (ADR-0017);
  - its grab key is matched *before* its modifier check, so a capture guard must stop Ctrl/Cmd+M;
  - `L` (connect) needs exactly one node selected, and offers only targets in the armed allow-list (§3.1).
- **Touch.**
  - Foblex listens to `touchstart` (passive) and `touchmove` on `document`, and sets `touch-action: none` on `f-flow`.
  - Mouse events within 800 ms of a touch drag are ignored as synthetic.
  - Node drag, pan, linking and pinch all worked.
- **Zoom.** Wheel zoom changes the scale by ±0.1 per event, double-click by +0.5. Pinch tracked the finger spread
  exactly.
- **Docs.** flow.foblex.com is blocked by this environment's egress proxy. The bundled `node_modules/@foblex/flow/AI.md`
  and `llms-full.txt` (from raw.githubusercontent.com) are the references, plus the JSDoc in `index.d.ts`.

## 6. Test-harness techniques that worked

**Touch input in Playwright,** through CDP (`hasTouch: true` context):

```js
const cdp = await context.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
for (/* steps */) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: nx, y: ny }] });
  await sleep(16);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
```

**Sampling just before paint.** This runs after every rAF callback, including Angular's zoneless change detection,
and after layout. It is the right moment to compare painted DOM with what an overlay drew. Sampling inside rAF gave
false drift.

```ts
function prePaintLoop(fn: () => void): () => void {
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden';
  document.body.appendChild(sentinel);
  let raf = 0, flip = false;
  const observer = new ResizeObserver(() => fn()); // ResizeObserver callbacks run after layout, before paint
  observer.observe(sentinel);
  const tick = () => { flip = !flip; sentinel.style.width = flip ? '2px' : '1px'; raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); observer.disconnect(); sentinel.remove(); };
}
```

**Other techniques:**
- **Overlay sync check.** The overlay records the transform it drew with. Compare each node's painted rect centre with
  `(x + w/2) * zoom + tx` from that transform. Run it during real mouse drags and wheel bursts, not only programmatic
  moves.
- **Waiting for a large graph.** Wait until `[data-node-id]` count = nodes and `[data-edge-id]` count = edges (drawn,
  §3.6), then two more frames.
- **Playwright in this container:**
  - Use `executablePath: process.env.PW_CHROMIUM_PATH` (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`);
  - add the launch args `--disable-background-timer-throttling --disable-renderer-backgrounding`;
  - headless Chromium uses software rendering, so read frame rates relatively.
- **Node 24 in this container** (Angular CLI 22.2 refuses Node 22.22.0): `npx -y node@24`, then put
  `~/.npm/_npx/<hash>/node_modules/node/bin` first on the `PATH`.

## 7. Spike measurements (Foblex Flow, for reference)

Medians of 5 trials, 200 nodes / 500 edges, headless Chromium:

| Measure | Result |
|---|---|
| First render | 349 ms |
| JS heap | 22.7 MB |
| Drag-pan / wheel zoom / node drag | 58.5 / 60 / 58 fps |
| Programmatic camera animation | 46 fps (39 fps with the 500-dot overlay) |
| Overlay drift at paint | 0 px |
| Whole-app bundle | 166 KB gzip |
| Functional checks | 21/21, with 7 workarounds |

Full comparison: [ADR-0016](../adr/0016-node-editor-library.md).
