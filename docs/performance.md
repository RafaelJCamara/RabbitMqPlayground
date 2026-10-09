# Frame rate

The editor has to stay smooth with a lot going on: **200 nodes, 500 edges and 500 messages in flight, at 45 frames a second or more, on a mid-range laptop.** That is a line of the acceptance of M1 (section 7 of [the plan](plans/m1.md)), and [ADR-0086](adr/0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md) says why it is done this way: a program can measure it and write the result down, but only a person with the right laptop can give the answer. This page is the tool and the instructions; the records are the files of `docs/performance/records/`, and the table at the end of this page is made from them.

**Where it stands.** The first record is from the laptop that S12 was built on: an i9-14900HX with an RTX 4070, which is a gaming laptop. It says the product is not slow there. It is a data point, not the answer. The answer is a record from a mid-range laptop (below), it is tracked in [#21](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/21), it does not block `v0.1.0` ([ADR-0091](adr/0091-the-frame-rate-on-a-mid-range-laptop-does-not-block-v0-1-0-and-is-tracked-in-issue-21.md)), and until there is one the line is not claimed.

## What is measured, and why

The plan sizes the editor for this canvas (section 6) and asks that it stays smooth on the kind of laptop that a learner is likely to have (section 7). A number from a fast machine only says that the product is not slow there, so the tool records what was measured and on what.

- **The frame rate of the page** while the scenario below runs: the time between two animation frames (`requestAnimationFrame`) for 10 seconds. The line is the **median** of those times as frames a second. The 1% low (1000 / the 99th percentile of the times) and the worst frame are in the record to show stutter, but the line is not on them.
- **The messages in flight**, counted twice a second in the same 10 seconds. The line needs the **fewest** of them to be 500 or more, so that a run on an easy scenario cannot pass.
- **The machine**: processor, cores, memory, graphics as the browser names them, the refresh rate of the display, the browser, and whether the laptop was on its charger and on which power plan. A number without these cannot be compared.

## The scenario

The canvas of [`web/e2e/support/big-canvas.ts`](../web/e2e/support/big-canvas.ts): 20 producers, 30 exchanges, 100 queues and 50 consumers (200 nodes) and 500 edges (each producer is linked to an exchange, each queue is bound from three exchanges, each consumer subscribes to three queues, each exchange is bound to the next one).

- Each of the 20 producers sends **one message every 200 ms** (100 a second), with a key that routes, so that every message goes to one queue and its consumer. A producer that sat on a fanout exchange is pointed at a direct one: a fanout copies a message to about ten queues, and every copy counts as a message in flight.
- A message takes **6 seconds** to travel (a long latency), so **about 600 messages are in flight for the whole window**: 100 a second times 6 seconds.
- The messages are spread in time on purpose. Messages at the same place on an edge are drawn as one marker with a count ([`group.ts`](../web/projects/app/src/app/canvas/overlay/group.ts), `SHAPE_LIMIT` 500), so a scenario in which they were piled up would measure a few markers and not 500 moving shapes. One message every 200 ms from each producer keeps them at different places along the edges.
- Before each window the tool waits until the simulation clock has passed one latency and the count is at 500, so the window never contains the filling-up.

## How to run it on a mid-range laptop

You need Git and Node: the version in [`.nvmrc`](../.nvmrc) (24), and `web/package.json` accepts `^22.22.3 || >=24.15.0`. Run it from a desktop session of the laptop itself (not over SSH, not in a container): the window needs a real display.

```
git clone https://github.com/RafaelJCamara/RabbitMqPlayground
cd RabbitMqPlayground/web
npm ci
npx playwright install chromium
```

Then get the machine ready. Each of these changes the answer:

1. **Plug the charger in.** A laptop on its battery slows down to save power.
2. **Set the power plan to Balanced or Best performance** (Windows: Settings, System, Power & battery, Power mode; macOS: Battery, Energy mode; Linux: `powerprofilesctl set balanced`). Battery saver and low power mode off.
3. **Close the other applications**: browsers, chat, video calls, editors, sync clients, anything that is building or downloading.
4. **Leave the lid open and the display on**, and use the laptop's own display. A closed lid or a display that goes to sleep draws no frames.
5. **Do not touch the machine while it runs**: no typing, no mouse. Keep the window in front.
6. **`E2E_CPU_SLOWDOWN` must not be set** (`unset E2E_CPU_SLOWDOWN` in a POSIX shell, `Remove-Item Env:E2E_CPU_SLOWDOWN` in PowerShell). It slows every page of the e2e tests, and the row that says `none` would not be none. The tool stops with a message if it is above 1; it makes its own slowdowns (below).
7. **The system must not be asking for less motion** (the "reduce motion" or "animation effects" setting). The page then draws no moving messages, and the tool stops with a message.

Then:

```
npm run perf:fps
```

**What the window shows.** A Chromium window of 1440 by 900 opens in front. First it shows an almost empty page for a second (that is how the refresh rate of the display is read), then the editor with the big canvas: 200 small nodes and 500 edges, with a stream of messages along them that fills up over the first 7 seconds or so. It then measures 10 seconds with nothing slowed (the row `none`), and 10 seconds again with the processor slowed down 4 times (the row `4x`). The window closes by itself.

**How long it takes.** A few minutes in all, most of it the build of the app for the tests (`npm run build:e2e`, a minute or two the first time); the measurement itself is under a minute. `FPS_SECONDS` (default 10) sets the seconds of each window, and `FPS_THROTTLE` (default `1,4`) the slowdowns to measure at, where `1` is none. Leave both as they are for a record that you mean to keep.

**What it leaves.** One file in `docs/performance/records/`, named after the day, the processor and the power state (`2026-10-09-intel-r-core-tm-i9-14900hx-ac.json`), and the table at the end of this page rewritten from all the files there. It does not fail on a low frame rate: the record is the result. It fails when the measurement itself is not valid: the scenario did not hold (fewer than 100 messages ever in flight), the window was hidden, or the page threw.

Then:

1. Check the new rows of the table: the machine (second column) is the one you meant, the power (third) says `AC`, and the messages in flight (seventh) are 500 or more.
2. Commit `docs/performance/records/*.json` and `docs/performance.md`.
3. Post the rows of your record from the table as a comment on [#21](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/21), with the machine's name.

## What counts as a mid-range laptop

Integrated graphics (no discrete graphics card), 4 to 8 processor cores, 8 to 16 GB of memory, and made in the last five years. The names of the processor and the graphics are in the record, so anyone can check a claim against it. The definition is the owner's to change (ADR-0086); it is written to be checked, not to be right for every reader.

## The rule

A record **meets the line** when its row with CPU throttle `none` has a **median of 45 frames a second or more** and **500 messages in flight or more at the fewest**. The last column of that row says which (`yes` or `no`), and the tool decides it (`verdict` in [`web/tools/perf/fps.ts`](../web/tools/perf/fps.ts)).

The rows with a throttle (`4x`) have no verdict: they are **data points**. A processor that is slowed down by software is not a mid-range machine (its graphics, memory and caches are not), so such a row says how the product behaves when the processor is the bottleneck, and not whether the line is met. Only a mid-range laptop's `none` row answers.

## If it is below 45

Open an issue with the record file and the rows of the table, and say what the machine is. The next step is a fix, or an ADR that changes the line with its reason. **Do not lower the line to fit a record, and do not leave a record out because of what it says** (ADR-0086).

## The records

Newest first, one row for each rate of each record.

<!-- records:start -->

| Date | Machine | Power | CPU throttle | Median fps | 1% low | Messages in flight (min) | Meets 45 fps |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 2026-10-09 | Intel(R) Core(TM) i9-14900HX, ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11 vs_5_0 ps_5_0, D3D11), 32 cores, 32 GB, 164 Hz | AC, Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e (Balanced) | none | 147.0 | 99.0 | 600 | yes |
| 2026-10-09 | Intel(R) Core(TM) i9-14900HX, ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11 vs_5_0 ps_5_0, D3D11), 32 cores, 32 GB, 164 Hz | AC, Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e (Balanced) | 4x | 22.7 | 6.1 | 600 | data point |

<!-- records:end -->

The table is written by `npm run perf:render` (which `npm run perf:fps` runs at its end) from the files in `docs/performance/records/`, and `npm run perf:check` fails when it is out of date; `npm run docs:check` runs that check too, so CI holds it. Do not edit it by hand.

| Column | Is |
| --- | --- |
| Date | The day of the run. |
| Machine | Processor, graphics as the browser names them, cores, memory and the refresh rate of the display. |
| Power | On the charger (`AC`) or on the `Battery`, or `Unknown` where the browser cannot say; then the power plan, where the system can say it. |
| CPU throttle | `none`, or how many times the processor was slowed down. |
| Median fps | 1000 / the median time between two frames. Cut to a tenth, not rounded: 44.96 reads 44.9, never 45.0 next to a `no`. |
| 1% low | 1000 / the 99th percentile of those times: how bad the worst frames are. |
| Messages in flight (min) | The fewest messages in flight at any of the samples of the window. |
| Meets 45 fps | `yes` or `no` for a `none` row (median at least 45, and at least 500 messages in flight); `data point` for a throttled row. |

## Where the parts are

| Part | File |
| --- | --- |
| The measurement (browser) | [`web/e2e/fps.spec.ts`](../web/e2e/fps.spec.ts), run with [`web/playwright.fps.config.ts`](../web/playwright.fps.config.ts). Never by CI and never by `npm run test:e2e`. |
| The statistics, the verdict, the file name | [`web/tools/perf/fps.ts`](../web/tools/perf/fps.ts) |
| The table | [`web/tools/perf/render.ts`](../web/tools/perf/render.ts) and [`render-fps.ts`](../web/tools/perf/render-fps.ts) |
| The records | `docs/performance/records/`, schema 1, one JSON file for each run |
