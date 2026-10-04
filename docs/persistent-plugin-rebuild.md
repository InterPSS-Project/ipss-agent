# Persistent InterPSS Plugin — Rebuild Guide

Rebuild `@deepseek-ai/dsh-interpss` (`interpss-persistent/`) **from the dynamic
plugin** (`interpss-dynamic/`) so both deliver identical behavior/UI.

## 1. Client (rebuild `lib/client.js` from `interpss-dynamic/client-body.js`)

Wrap the dynamic body in the persistent module loader, with three substitutions:

1. `return { inject: ['slots'], apply(ctx) { … } }` → `module.exports = { … }`
2. Transport swap (`host.call` → `/api` Typert):

```js
const callRemote = (method, input) => {
  const connection = ctx.get('connection')
  if (connection === undefined) return Promise.reject(new Error('InterPSS: client connection service unavailable'))
  return connection.rpc.call('/api', 'interpss/' + method, { args: { input: input } }).then((result) => {
    if (result && result.ok) return result.value
    const message = (result && result.error && result.error.message) ? result.error.message : 'remote call failed'
    return Promise.reject(new Error(message))
  })
}
```

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-interpss",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    // <dynamic body, transformed per above>
    return module.exports;
  }});
```

3. **Timers and globals.** A dynamic Client half gets only `ctx`, `React`, `host`,
   `styles` and `console` — no `setInterval`, `clearInterval` or `window`. The
   bridge-case mirroring effect therefore uses the Cordis timer service
   (`inject: ['slots', 'timer']` with `ctx.timer.interval(sync, 4000)`, whose
   disposer is returned from the effect) and has no window-focus refresh. The
   persistent browser bundle uses `setInterval(sync, 4000)` plus
   `window.addEventListener('focus', …)` and keeps that version. This is the one
   deliberate divergence between the two tab bodies; everything else stays
   byte-identical, so a rebuild must re-apply it. Anything new in the shared body must
   respect this: the draw.io preview's Escape handling rides the focused overlay's
   `onKeyDown` rather than a `window` listener for exactly this reason, so it needed no
   divergence of its own.

Mechanically, only the **tab body** changes between rebuilds: splice the dynamic
file's region from `    const PRESETS = [` up to (excluding) its
`    const slots = ctx.get('slots')` into the persistent file between the
transport block and the `    // --- ACLF tool-card result explorer` section. That
keeps the persistent-only tool-card section, all six `slots.inject`
registrations, and the module footer intact — copying only up to
`const slots` drops the tool cards, and diffing the result against the previous
`lib/client.js` should show your UI change alone.

`node scripts/sync-persistent-client.mjs` performs that splice for you — it also rewrites
`interpss-dynamic/client.js` as a byte copy of the body, and it refuses to run when the
markers or the timer form have drifted, so a half-splice cannot be written silently. The
manual procedure below is what it automates, and §9 asserts the same invariants.

**Since 0.6.3 the two bodies differ only by that timer swap**, so the splice is safe again
— with one mandatory correction. Baseline the change first:
`node scripts/test-interpss-client.mjs` must be green, and its §9 asserts the invariant this
procedure depends on. Then:

1. splice the body region as above, and
2. **re-apply the persistent timer form**, which the splice overwrites with the dynamic
   `ctx.timer.interval` version:

```js
// after the splice, in lib/client.js — put the persistent transport back
        const timer = setInterval(sync, 4000)
        const onFocus = () => sync()
        window.addEventListener('focus', onFocus)
        return () => {
          alive = false
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
```

Then re-run the guard: §9 fails if the bodies diverge by anything other than that swap, if a
helper the body needs drifts into the persistent-only region, if `client.js` and
`client-body.js` stop being byte-identical, or if the two hosts stop agreeing on `METHODS`
or on the shared features (CSV sort, CA overload threshold). Before 0.6.3 this class of
drift was silent: `lib/client.js` had accreted sortable CSV headers (`csvHeaderCell`,
commit 27a66e9c) and the whole CA over-loading threshold field that the dynamic body never
got (142 changed lines), and the guard stayed green because it only ever read the dynamic
body. Both sides now carry those features; keep it that way rather than editing one side.

**Declare state before anything that reads it.** A `React.useEffect` dependency array is
evaluated *during* render, so an effect placed above the `const [x, setX] = React.useState(…)`
it depends on throws `ReferenceError: Cannot access 'x' before initialization` (a temporal
dead zone error). Because `InterPssView` is one component, that throw unmounts the whole
view and the tab renders **completely blank** — with no message and nothing in the Host's
diagnostic log, since the failure is entirely client-side. This shipped once (0.6.0) when the
draw.io preview's focus effect landed above its own state block; 0.6.1 moved it below. Keep
new effects under the state they read, and run the component-level check described in §4
before packing — `node --check` cannot see this class of bug.

## 2. Host (`lib/index.js`)

Keep the persistent architecture — it is the `javaBridge` **provider** and the
registrar of the browser-facing `/api` endpoints (the dynamic host consumes
`javaBridge` and uses `harness.handle`; it cannot be used verbatim). Ensure:

- `inject: ['typert']` on the default export (else `apply()` runs before the
  typert registry and `/api` endpoints silently 404)
- `METHODS` matches the dynamic list (23): `isActivated, checkResult,
  checkResultFiles, listCases, readCsv, busConnections, runAclf, runCa,
  runReport, getAclfOptions, saveAclfOptions, listCaFiles, getCaOptions,
  saveCaOptions, getNetDiagramOptions, saveNetDiagramOptions, loadCase,
  summarizeResult, getNetworkInfo, getBridgeCase, listDrawioFiles, readDrawio,
  openDrawio`
- `readCsv` whitelist includes `contingency`: `_DF_(bus|branch|gen|load|contingency)\.csv`
- **Shared Host features (both halves, since 0.6.3)**: `applyCsvSort(rows, header, column,
  desc)` — byte-identical in both hosts, so the sorted order cannot drift; `readCsv` applies
  it *before* slicing the page, so a sorted table is sorted over the whole file rather than
  the rows already loaded, and reports back the sort it actually applied (`sortColumn` /
  `sortDesc`, `null` for an unknown column). The CA `overloadThreshold` chain is also on both
  sides: `DEFAULT_CA_CONFIG.overloadThreshold` (90), `validateCaConfig` rejecting anything
  outside 0–1000, `saveCaOptions` round-tripping it into `config/ca_run.json`, and `runCa`
  passing `caConfig.overloadThreshold` as the 7th `runContingency` argument. The CLI fallback
  passes no threshold in either host (positional args only), so the file is what carries it.
- **Accepted Host divergences** (do not "fix" these):
  - the **chat tools** are persistent-only — `interpss_case_load`, `interpss_network_info`,
    `interpss_run_aclf`, `interpss_case_summary`, `interpss_run_gvy`, `interpss_run_ca`.
    The dynamic Host is an injected body with **no imports at all**, so it cannot carry them,
    and the persistent host's `writeConfigText` fallback (which needs `node:fs` for a direct
    write when the DSH fs sandbox denies one) is unavailable there for the same reason: the
    dynamic host writes config with the `fs` service alone.
  - `getBridgeCase`: the persistent Host answers from its module-level `lastLoadedAbs`
    mirror; the dynamic Host delegates to `javaBridge.caseInfo`.
- **Diagram source (Host half, since 0.6.6)**: `listDrawioFiles` takes the **selected case**
  and lists the `.drawio` files *directly inside* `<case folder>/diagram/` —
  `wspace/data/ieee/Ieee14Bus/diagram/*.drawio` — as workspace-relative paths, sorted by
  name. A diagram belongs to a case and the Diagram tab draws this answer
  alone, so an **absent case or folder is an empty list, not an error** ("this case has no
  diagram yet" is a state the tab renders); a malformed case path *is* an error. 0.6.1–0.6.5
  instead walked the whole workspace through `scanDrawio` (skipping `node_modules`, `.git`,
  `target`, `build`, `logs`, `temp`, `.venv`, `.mvn`, `.npm-cache-local` and the local
  backup, capped at depth 6 and 200 files); that scanner and its constants are **gone**, and
  the guard asserts neither host still carries them. `readDrawio` is unchanged: it takes a
  **workspace-relative** `.drawio` path — not the `data/…` form `readCsv` uses — and rejects
  `..`, any non-`.drawio` name and anything over `MAX_DRAWIO_BYTES` (4 MiB, 0.6.20; 2 MiB before 0.6.19) *before* reading,
  so an oversized file never reaches the RPC payload. `MAX_DRAWIO_BYTES` and `readDrawio` are
  byte-identical in the persistent Host and the two dynamic ones.
- **Edit in the local draw.io app (Host half, since 0.6.12)**: `openDrawio` takes the same
  workspace-relative `.drawio` path and the same validation as `readDrawio`, turns it into a
  host path with `fs.processPath`, and launches it. The browser cannot start a process, so this
  has to be Host work — and the launch goes through the **`subprocess` service**, not
  `node:child_process`: the dynamic half is an injected body with **no imports**, and `subprocess`
  is the sandbox-aware execution world the harness already manages. A shared block between the
  `// --- Launch the local draw.io app` and `// --- end draw.io launcher` markers is
  **byte-identical in both hosts** (the guard slices exactly those markers and compares), so the
  two halves cannot answer differently:
  - **Which executable to run is configuration, not code** (0.6.16): `config/ipss_plugin_env.json`
    carries an ordered `drawio.launchers` list, so a Windows or Linux install names its own
    draw.io path instead of living with the macOS default. `readDrawioLaunchers(fs, root)` reads
    it from the project config beside `aclf_run.json`; `drawioLauncherList(parsed)` validates the
    entries (a non-empty string `exe`, string-only `args`, a `label`, at most
    `DRAWIO_LAUNCHER_LIMIT`); `drawioLaunchersFor(list, platform)` orders them. The list compiled
    into the plugin (`DEFAULT_DRAWIO_LAUNCHERS`) is **exactly the shipped file's list**, which
    §13 asserts — so deleting the file changes nothing, and a missing, unreadable or malformed
    file falls back to those defaults **with a warning** that rides along in the button's error
    instead of silently doing nothing.
  - Each entry's optional `platform` tag (`darwin` / `win32` / `linux`, plus the hand-written
    `macos` / `windows` / `posix` spellings) puts this machine's entries first and the untagged
    ones — the file-association fallbacks — last. An entry for **another** OS is skipped by
    filter, and, belt and braces, would not resolve anyway: the platform only decides *order*.
    `drawioPlatformKey()` reads `process.platform`, which is a plain Node global the persistent
    Host certainly has and the dynamic body may read despite importing nothing; when it cannot,
    the key is `''` and **every** launcher is tried in file order, so the same committed file
    works on a host whose OS cannot be identified.
  - The macOS entries are `open -a draw.io <file>` then the app binary, then the untagged
    `open <file>` / `xdg-open <file>` associations; Windows has
    `C:\Program Files\draw.io\draw.io.exe` then `cmd.exe /c start "" <file>`; Linux has `drawio`,
    `/opt/drawio/drawio` then `xdg-open`. Each rung calls `resolveExecutable` **before**
    `sp.spawn`, so a command that is not installed comes back as a message rather than a spawn
    failure, and every failure is reported together with that launcher's own stderr. `open` exits
    0 once the OS has the file, so a success means "launched", never "saved".
  - `openDrawio` is the 21st `METHODS` entry; adding it to one half only is what §9.4 catches,
    and §13 drives the ladder itself (the only executable check of it, since the real
    `subprocess` service exists only inside the Host).
- **`getBridgeCase`**: the persistent Host answers from its module-level
  `lastLoadedAbs` / `lastLoadedBusCount` / `lastLoadedBranchCount` mirror. A
  dynamic Host has no such mirror, so it delegates to
  `javaBridge.caseInfo('ieee', '')` and converts the absolute path back with its
  `relativeCasePath()` helper (anchored on `/wspace/data/`). Both return
  `{ ok, case, busCount?, branchCount? }` with `case` wspace-relative, and neither
  boots the JVM merely to answer
- **CA run config** (since 0.3.16): the case-folder `config/ca_run.json` is resolved by
  `resolveCaRunConfig(ctx, root, parent, explicit)` — explicit dialog payload →
  case file → per-case filename discovery — and its `custom` entries become the
  absolute `contPath` / `monitorPath` the bridge already takes
  (`runContingency`'s signature is unchanged). `listCaFiles` lists the case
  folder's `.json` files with their `contingencies[]` / `monitored_branches[]`
  counts, `getCaOptions` returns the config plus a warning when the file is
  unreadable, and `saveCaOptions` validates and writes it. The dynamic host
  carries the same four functions, so the two cannot drift
- `javaBridge` provider exposes `runAclf`, `runContingency`, `runReport`,
  `loadCase`, `summarize`, `getNetworkInfo`, `caseInfo`, and `javaLauncher()`
  (the resolved `java` path consumed by the dynamic plugin's CLI fallback).
  `caseInfo(format, absCase)` returns the network info of a case, loading it only
  when the embedded JVM does not already hold it; the module-level `lastLoadedAbs`
  mirrors `IpssAgentBridge.loadedInput` (set by `loadCase`, `runAclf`, and
  `runContingency`) so a converged load flow is reused rather than discarded
- **Chat tools**: `apply()` registers every definition in `chatToolDefs`
  (`caseLoadTool(ctx)`, `networkInfoTool(ctx)`, `runAclfTool(ctx)`,
  `caseSummaryTool(ctx)`) on the host tool registry via
  `ctx.effect(() => tools.register(...))`, guarded by `ctx.get('tools')`
  (the row only injects `typert`) with a `diag()` line either way. `METHODS` is
  unchanged — tools add no `/api` endpoint
- **`interpss_case_load`** is the explicit load step. It adds no bridge method: it
  resolves the case and calls the same `javaBridge.caseInfo()` the other tools use,
  so it reuses a held case (`alreadyLoaded: true`, no re-parse) and otherwise loads
  it, reporting the counts. Its description and the other two tools'
  descriptions carry the shared `LOAD_FIRST_HINT` ordering sentence; nothing
  enforces the order, so the other tools must keep loading on demand
- The InterPSS tab's case selection reaches the tools through the existing
  `checkResult` RPC, which records the selection per session; do not add a Client
  call or a new endpoint for it
- Case selection for every tool goes through the shared `resolveToolCase()`
  (argument → tab selection → bridge-held `lastLoadedAbs`); `casePartsOf()` and
  `resolveAclfConfigPath()` are also shared with the service, so the tools and
  the `/api` RPCs cannot drift. `runAclfTool` passes the case-folder
  `config/aclf_run.json` (else project `config/aclf_run.json`) and
  `wspace/<case dir>/result` to the bridge, and reports non-convergence as
  `ok: true, converged: false`
- **ACLF result explorer** (Client half): `runAclfTool.output.presentationMeta`
  projects `{ ok, case, source, resultDir, converged, files }` (never rows or
  live objects) into the card's `block.meta`, and `lib/client.js` registers
  `tool.call.toolview` with `key: 'interpss_run_aclf'` to render Bus / Branch /
  Gen / Load tables from it via the existing `interpss/readCsv` RPC. The card is
  a hook-free gate (`aclfCardMeta`) in front of a hook-using table so its hook
  order cannot depend on the running → settled transition, and it declines to the
  generic row on any malformed or missing metadata
- **Report button** (Client half): next to the explorer scopes, calling
  `interpss/runReport` with an explicit `reportType: 'aclf'` and then
  `props.openFile('wspace/' + resultDir + '/AC_Loadflow_Report.md')`. The Host
  `runReport` treats an explicit `reportType` (`aclf` | `nerc`) as authoritative
  and only falls back to the contingency-CSV auto rule when it is absent or
  unrecognized, so the tab's own Report button is unchanged. `METHODS` still has
  no new endpoint — `reportType` is an added optional input field
- **Diagram preview** (Client half, since 0.6.1): a `.drawio` file is read through
  `interpss/readDrawio`, decoded with `diagramXmlFrom`, and rendered with `parseDrawioScene` +
  `DrawioDiagram` as inline SVG. (It carried a Rendered / Source toggle until 0.6.34, which removed
  it: the tab always draws the rendered scene.) Since 0.6.9 that preview has
  exactly **one** surface — the **Diagram tab** below — and `readDrawio` has exactly one
  caller. 0.6.1–0.6.8 the InterPSS action row also carried a **Diagram** button that opened the
  same preview in a modal, gated by the selected case's `diagram/` folder and nothing else
  (`refreshCaseDiagrams` re-read `listDrawioFiles` on every case-selection change — it rode
  `onCaseChanged` — stored the answer in `drawioFiles`, and the button took both its `disabled`
  state and its tooltip from that one fact; `drawioDirectPath` was the pure "exactly one
  diagram opens directly, skipping the picker" rule). 0.6.9 deleted the button, the modal and
  those helpers rather than leave a second, unmounted copy of the preview to drift: guard §10
  asserts the absence of `drawioFiles`/`drawioOpen`/`drawioDirectPath` and §12 that one caller
  of `readDrawio` remains.
  The renderer is **self-contained and offline on purpose**:
  the harness forbids frames (`frame-src 'none'` in the preview CSP) and the app page CSP
  cannot be assumed, so an embedded draw.io viewer or `embed.diagrams.net` iframe is not an
  option. It draws the subset these workspaces produce — rounded rectangles, ellipses, text
  labels and orthogonal edges — and covers two things a naive reader gets wrong:
  - `diagramXmlFrom` accepts **both** storage forms: plain XML, and draw.io's
    `base64(raw-deflate(uri-encoded XML))`, inflated with `DecompressionStream('deflate-raw')`
  - `parseDrawioScene` resolves geometry **down the parent chain with the parent's own
    `mxGeometry`** (a descendant lookup would take a child's box for a `group`), and it
    **skips `group` cells entirely** — a group is a container that draws nothing, while its
    children carry geometry relative to it (this workspace's transformer symbols are five
    groups of two ellipses each; drawing the groups adds five spurious boxes)
  The view registers no `window` listener of its own (see §1.3), which is why the modal this
  replaced needed no second divergence either.
- **Diagram pan / zoom / fit** (Client half, since 0.6.2): the rendered pane is one SVG
  whose `viewBox` moves, so a zoom step re-parses nothing. The view's `rect` is the visible
  rectangle in scene coordinates (`null` = fit, which is simply the scene's own viewBox);
  the wheel zooms about the cursor and dragging pans. The cursor anchor is computed through
  the box `preserveAspectRatio="xMidYMid meet"` actually draws — the smaller of the two
  ratios, centred — because using the element's own box would let the anchor drift as the
  pointer moves off centre. The wheel listener is registered natively with
  `{ passive: false }` rather than through `onWheel`: React delegates wheel passively, so
  `preventDefault` would be ignored and the page behind the pointer would scroll while
  zooming. `drawioZoomRect` clamps to 0.1x–12x and always derives height from width, so the
  aspect ratio cannot drift. All of it is client-only: `METHODS` and the Host half are
  unchanged.
- **Diagram paint order** (Client half, since 0.6.4): `parseDrawioScene` records every cell's
  **document position** (`order`) and `DrawioDiagram` emits its groups sorted by it, so
  vertices and edges interleave the way draw.io paints them. This is not cosmetic — the
  workspace diagram declares `bg`, an **opaque 900×760 white rectangle**, *before* its
  branches (cell order 2, first edge 32). Drawing every edge first and every vertex
  afterwards (0.6.1–0.6.3) put that page fill on top of every branch, and the preview
  showed a one-line diagram with no lines in it. The same change moved the
  no-`strokeColor` fallback from slate `#64748b` to mxGraph's own default **`#000000`** —
  the workspace diagram's 2 unstyled edges were the only two drawn a different color from
  the other 25 (both turned out to be stray edges and are no longer in the file, so the
  guard checks that fallback with a synthetic diagram). Guard §3/§4 assert the paint order —
  the page fill precedes every branch, and the emitted order is non-decreasing document
  order.
- **Latent `const` reassignment** (Client half, fixed 0.6.4): `parseDrawioScene` built
  `from`/`to` with `const`, then reassigned them when an edge names no source/target *cell*
  and falls back to its own `sourcePoint`/`targetPoint` `mxPoint`s (or to its `Array`
  points). Every edge in this workspace resolves through a cell, so the branch never ran
  here — but any draw.io diagram with a **free-floating edge** threw
  `TypeError: Assignment to constant variable` and rendered no preview at all. The guard
  covers it with a synthetic source/target-point edge.
- **Theme-aware diagram colours** (Client half, since 0.6.5): a draw.io model carries its own
  palette and these one-line diagrams are ink on paper, so painting them literally dropped a
  glaring white slab with black lines into the dark theme. `drawioThemeColor` re-expresses
  the **grayscale** part of the palette at paint time — paper → `--dsw-alias-bg-layer-1`,
  ink → `--dsw-alias-label-primary`, mid greys → `--dsw-alias-label-secondary` — and the
  rendered pane's own background uses the paper token too, so the letterbox padding around
  the model's `bg` rect matches. Three deliberate choices:
  - **Tokens, not a computed colour.** Both palettes ship in the stylesheets, so this needs no
    theme detection, no `theme` service dependency, and it re-colours the instant the theme
    switches. (The client `theme` service does expose `getTheme().active.colorScheme` and a
    `theme/change` event if a future change genuinely needs the mode in JS.)
  - **Applied in `DrawioDiagram`, not `parseDrawioScene`.** The scene keeps the authored
    colours, so the parse-level assertions (§3: the page fill is `#FFFFFF`, the stroke
    fallback is `#000000`) still describe the file, and a re-parse is not needed on a switch.
  - **Only near-grayscale values are re-mapped;** a saturated colour passes through, so a
    deliberately coloured element keeps its identity in either theme. The lightness extremes
    are tested **before** saturation, because HSL saturation is ill-conditioned near black
    and white: draw.io's default text colour `#111827` computes as 39% "saturated" while
    reading as plain ink, and testing saturation first left every default label near-black on
    a dark canvas. §5 covers the mapping and §4 the rendered result.
- **Diagram element tooltips** (Client half, since 0.6.7): hovering a bus or a branch in the
  preview shows the same tooltip the connection diagram shows, from the same builders —
  `busTooltip(record)` and `branchTooltip(row)` — so the two cannot word things differently.
  It is a client-only feature: `METHODS` and the Host half are unchanged.
  - **Element → data.** `parseDrawioScene` now also keeps what a tooltip needs: each edge's
    `id`/`source`/`target` and each vertex's `parent`. `drawioBranchPairs(scene)` resolves every
    interactive cell to a `busa|busb` key of lowercased bus cell ids. A branch is either one
    edge between two bars, or a transformer symbol drawn as **two chained edges** (`bus4 → xf8`
    then `xf8b → bus7`); an edge with a single bus end is paired with the sibling edge whose
    endpoint shares the same `parent` group, and both take the union of their bus ends — the
    group id, not the `xfN`/`xfNb` spelling, is what pairs them. The transformer **nodes** take
    their group's key too, so the symbol itself is hoverable. It is resolved once per parsed
    scene, not per repaint, and runs only when a `hover` prop is passed.
  - **Hit areas.** A branch is a 1.5px line and a bar is 6px wide, so the drawn geometry is
    impractical to hover: each interactive edge also emits an invisible twin polyline
    (`stroke: transparent`, `strokeWidth: 10`, `pointerEvents: 'stroke'`) and each interactive
    vertex a transparent rect padded by 4 scene units. They live inside the SVG, so they follow
    the `viewBox` with no coordinate maths, and they do not stop propagation — panning and
    wheel-zoom still work over them.
  - **Data.** The branch table is indexed once per opened diagram: `readCsv` is paged over
    `<case>/result/<stem>_DF_branch.csv` (5000 rows/page, 20-page cap) into a
    `Map<'busa|busb', row[]>` — an **array** per pair, so parallel circuits all match — plus a
    `canonical` map of the `BusN` spelling the Host matches on (a diagram cell is `bus1`, but
    `busConnections` compares against the table's `Bus1` exactly; an isolated bus falls back to
    capitalising the cell id). Bus records are **not** preloaded: one `busConnections` call fills
    the cache for the hovered bus *and its branch neighbours*, and `readCsv` rows are raw CSV
    lines split at hover time because `branchTooltip` wants columns.
  - **Degradation.** With no result table the tooltip names the element and adds
    `no result data — run ACLF` and fires **no** call; with a table but no matching row it says
    `not found in the case result tables`. Fetch failures are swallowed: a tooltip is an
    enhancement and must never error or block the preview. The tip is dropped when the diagram
    is switched, and a late `busConnections` answer is applied only if that bus is still under the
    cursor. Guard §11 covers the pairing (all 25 edges resolve, and the 20 resolved pairs agree
    with the result table), the hit areas, the wiring and the tooltip wording.
- **Style fidelity (0.6.33).** The preview is compared against the draw.io app by eye, so the parser
  reads each style key the workspace's diagrams actually use. Honoured: `rounded` (a VALUE —
  `rounded=0`, which every workspace file writes, is square; `rounded=1` rounds by `arcSize`, default
  15 %), `align` / `verticalAlign` / `spacing` (a label's place inside its own box),
  `labelBackgroundColor` (the mask behind a `text` cell's glyphs, without which the wires cross the
  text), `fillColor`, `strokeColor` (including `none`), `strokeWidth`, `dashed`, `fontSize`,
  `fontColor`, `fontStyle` (bold/italic), `ellipse`, `group` (a container, never a shape),
  `exitX`/`exitY`/`entryX`/`entryY`, edge waypoints, `endArrow`, and `<br>` / `&#10;` in labels.
  **Ignored, deliberately and documented** (none of them present in the tracked diagrams): `html=1`
  inline markup, `rotation` / `flipH` / `flipV`, `startArrow` and the arrow shapes (`oval`,
  `diamond`, `open`) with `endSize`, `opacity`, `gradientColor`, `shadow`, `dashPattern`,
  `fontFamily`, `whiteSpace=wrap`, `exitDx`/`exitDy`/`entryDx`/`entryDy`, `edgeStyle` routing for a
  file with no waypoints, image/stencil shapes, `absoluteArcSize`, and a text-measured
  `labelBackgroundColor` (the mask covers the cell's box, which is text-sized in these files).
  Guard §19 pins all of it, on a fixture and on the tracked reference diagrams.
- **Diagram tab** (Client half, since 0.6.8; the only preview surface since 0.6.9): a
  **second `conversation.view`** entry —
  `{ id: 'diagram', order: 2, label: 'Diagram' }`, which lands between InterPSS (1) and
  Trajectory (10) — showing the preview full-size. It has **no heading and no subtitle** (0.6.10):
  the tab bar names the view and the first row (`Simu Case <path>`) says what is drawn, so a
  title block only pushed the diagram down. Its toolbar is controls only — the picker (when the
  case has several files), `−` / percent / `+` and the picker's `Fit` — the `R` / `S` view toggle
  led this row from 0.6.17 until 0.6.34 removed it; the
  `Scroll to zoom · drag to pan` hint that followed `Fit` was dropped
  in 0.6.11, because the gestures are discoverable without a sentence in the control row.
  The **draw.io-marked edit button** (since 0.6.12) that hands the open file to the local
  desktop app over `interpss/openDrawio` is deliberately **not** in that row: since 0.6.15 it
  sits at the **upper-right corner of the tab**, as the last child of the header row that names
  the case (`justifyContent: 'space-between'` — `Simu Case <path>` on the left, the launch
  outcome and the button on the right), so it is always in view beside the drawing's own
  controls. The launch outcome — `Launched draw.io (open -a draw.io)` or the
  Host's own reason — prints to the button's left rather than replacing the preview. The button
  is in flight (`disabled`, `cursor: progress`) while the Host launches.
  - **Both earlier corners failed in the app, which is why it is in the header now.** At the end
    of the toolbar (0.6.12) the one control that leaves the app sat among the zoom controls; a
    row of its own below the drawing (0.6.13) landed **below the fold** — the canvas is 70vh
    plus the tab's chrome — so the button looked like it had vanished; pinning that row with
    `position: sticky; bottom` (0.6.14) kept it visible but as a full-width strip floating over
    the canvas, which needed `pointerEvents: none` so it would not swallow drags and wheel-zoom,
    and a shorter `62vh` canvas to stay off the fold. The header needs none of that: the canvas
    is back to `70vh` / min `320px`, and there is no sticky element or pointer-events carve-out
    anywhere in the view.
  - Guard §12 walks the button's **ancestor chain** and asserts that placement — a
    `space-between` top row containing the case label, with the edit controls as its **last**
    child — because "it is on the page somewhere" would not hold it there, let alone keep it
    visible. It also asserts the retired workarounds are gone (no `position: sticky` and no
    `pointerEvents` on the button). It reuses
  every renderer piece (`diagramXmlFrom`, `parseDrawioScene`, `drawioBranchPairs`,
  `DrawioDiagram`, the pan/zoom math, `busTooltip`/`branchTooltip`) and adds **no new preview
  endpoint**: `listDrawioFiles` finds the case's diagrams, `readDrawio` reads one,
  `checkResult` supplies the result dir the tooltips page `<stem>_DF_branch.csv` from,
  `busConnections` fills a hovered bus, and `openDrawio` is the launcher above.
  - **The case is not chosen here.** The InterPSS tab owns "the current simulation case",
    so `onCaseChanged` publishes its selection to the module-level `selectedCaseInput` and
    the Diagram tab seeds from it on mount. That is sound because the conversation view
    mounts **one view at a time** — there is never a second mounted view to miss a change —
    and it keeps the two tabs from ever disagreeing. `adoptSelectedCase()` is the mirror's
    counterpart: a one-shot `getBridgeCase` on mount (not a poll, since a tool can only run
    while the Chat view is mounted) adopts a case the Host loaded, and so does the
    InterPSS tab's own mirror. The tab therefore needs **no timer**, which keeps §1.3's one
    timer swap the tab body's only dynamic/persistent divergence.
  - **`drawioTabChoice(files, remembered)`** is the pure picker rule: reopen the diagram the
    user last chose when it is still in the folder (the module-level `diagramChoice`
    survives a tab switch), else the first, and `null` for an empty folder — the tab renders
    "no diagram yet" rather than an empty pane. The wheel/pan handlers keep the geometry the
    modal used, on this view's own state, and the wheel listener is still registered natively
    so `preventDefault` is permitted.
  - **Render-time voltage annotation (since 0.6.18)**: a bus whose solved `VoltMag` is outside
    **[0.9, 1.1] pu** is painted **red** — the bar's fill (`#CC0000`) and outline (`#7F0000`) plus
    its `Bus-N` text — and nothing is written: the `.drawio` file stays the authored artifact and
    so do the desktop app, the generator's PNG preview and the parsed scene (`DrawioDiagram` reads
    an optional `alert` map of lowercase `busN` ids and chooses colours at paint time; with no
    `alert` prop the emitted tree is byte-identical to before, which §14 asserts).
    - The band is a client constant (`DRAWIO_V_BAND`), checked strictly (`0.9`/`1.1` are in band)
      and only for buses present in the case's `<stem>_DF_bus.csv`; a blank or non-numeric
      `VoltMag` is never annotated. Colours are **saturated on purpose**: `drawioThemeColor`
      passes a saturated value through, so a violation reads the same in the light and dark theme.
    - The data comes over the existing `interpss/readCsv` (`_DF_bus.csv` is already whitelisted),
      page by page, with the columns located by **header name** — `VoltAng` and `NomVolt` sit right
      beside `VoltMag`, so a positional read would paint the wrong buses — and paging stops once the
      open scene's buses are answered (which is what keeps a 2000- or 78k-bus table cheap). No ACLF
      results, no bus table or a failed read simply means no colouring.
    - The label's white paper box is **not** recoloured: it is what masks the wires under the text.
      Note the two label spellings in the wild — the generated files paint a real white rect
      (`rounded=0;fillColor=#FFFFFF`), the older hand-laid ones use a `text;` cell with
      `labelBackgroundColor` and paint no box — §14 covers both.
    - Colour alone is not accessible, so the same fact rides the tooltip (`drawioBusText` appends
      `⚠ |V| outside 0.9–1.1 pu`), and the toolbar stays controls-only.
  - Guard §12 renders the view — idle, no case, no diagram, a listing failure, an open
    diagram with a live scene, a wheel-zoomed open diagram, the tooltip element and the Source
    view — because a reference error anywhere in it unmounts the tab. It also asserts the
    registration, the `selectedCaseInput` wiring, the picker rule and that §7's regex parses
    **every** effect of the new view. It is the replacement for the retired §8, which rendered
    the modal.
  - The zoom picker is asserted structurally, not visually: it is a `select` in the toolbar row
    whose options are exactly the presets **plus `Fit` last** (and the current non-preset level, in
    order, selected), it sits at `−` + 1 and `+` − 1 in that row, its handler routes both a
    percentage and `fit` without throwing, the row ends at `+` with no separate Fit button, and a
    fitted view shows `Fit` as the selected entry. Three of those checks would pass on a screenshot that showed a stale label, which is
    why the wheel-zoomed fixture is rendered too. The presets are also round-tripped through
    `drawioZoomPercent`, so picking a level cannot land on a different one than it displayed.
- **`interpss_case_summary`** ports `IpssAgentBridge.summarize()`. Java always returns
  every result section in full (only the requested one is ranked/limited) and
  `text` is a JSON string inside the envelope, so the tool does a second parse and
  keeps just `netResults` plus the requested section, mapping entries to uniform
  `{ id, name, bus?, value, unit, mvar? }` rows. It rejects an unknown scope (the
  Java switch silently falls back to `net`, which truncates every section in model
  order) and uses `numRec = 1` for scope `net` so the bridge payload stays small.
  The case-wide totals are populated by `net` only (`converged` by every scope), and
  `render()` gives a ranked scope its table alone — no `case · scope · converged` header
  and no blank line. Since 0.3.10 the `net` card drops that preamble too and renders only
  its two totals lines; the case identity lives in the tool result, not on any card
- **Short-result cards** (Client half): `caseLoadTool`, `networkInfoTool` and
  `caseSummaryTool` each project a small `presentationMeta`
  (`{ ok, case, source, alreadyLoaded, format }`, `{ ok, case, source, lfConverged }`
  and `{ ok, case, scope, rowCount }` respectively), and `lib/client.js` registers
  `tool.call.toolview` for `interpss_case_load`, `interpss_network_info` and
  `interpss_case_summary` with one shared `toolTextCard(label)` component. The
  shipped generic `ToolRow` keeps its output behind `expanded` (default false), so
  without these cards those summaries are invisible in the conversation.
  `toolResultText()` is shared with the ACLF card and joins **every** text block —
  requiring exactly one silently dropped the summary whenever the content layout
  differed
- **Windows JDK discovery**: `ensureBridge()` sets `process.env.JAVA_HOME` from
  `discoverJavaHome()` before `ensureJvm()` (java-bridge reads JAVA_HOME only at
  that point, and it is usually missing in the Windows harness env); the CLI
  fallbacks use `shellQuote(javaBin())` instead of bare `java`
- Declare `@deepseek-ai/dsh-typert-protocol` in `dependencies` (it was a phantom
  import) and keep the `DIAG` path portable (`os.tmpdir()`)

The **dynamic** host (`host-body.js` / `index.js`) must stay in sync: its CLI
fallbacks use `shellQuote(javaLauncher())`, where `javaLauncher()` reads
`ctx.get('javaBridge').javaLauncher()` and falls back to `java`.

## 3. Pack, install, verify

**Always bump a minor version before packing** (e.g. `0.3.17` → `0.3.18` in
`package.json`). Each rebuild must ship a new version so the install picks up
the fresh tarball instead of a cached older package. Re-packing the *same*
version is silently skipped by pnpm — the installed copy stays stale; if that
happens, `pnpm remove` then `dsh plugin add` forces the relink, and comparing
the installed file's SHA-256 against the source is the check that catches it.

The profile pins an exact tarball path, so the install only ever works while that
file exists: an `npm cache`/store copy is not a substitute for the tarball on
disk.

```bash
cd interpss-persistent
# bump version first, e.g. 0.6.2 → 0.6.3
node --check lib/index.js && node --check lib/client.js
# corepack refuses to run without a packageManager field and tries to ADD one to the
# nearest package.json it can write — under this harness that is $HOME, which the file
# sandbox denies (EPERM: open '/Users/<you>/package.json'). Disable that lookup instead of
# granting it write access to your home directory.
COREPACK_ENABLE_PROJECT_SPEC=0 pnpm pack --pack-destination .   # npm pack where npm is on PATH

# tarball == source (under pnpm pack the only difference is package.json's final newline)
tar -xzf deepseek-ai-dsh-interpss-0.6.3.tgz -C /tmp/pkgv
diff -q lib/index.js  /tmp/pkgv/package/lib/index.js
diff -q lib/client.js /tmp/pkgv/package/lib/client.js

# install into the Desktop profile — a NEW version only needs `add`; do not `pnpm remove` first.
# In the Desktop app this is the plugin manager's own install action; the CLI equivalent is
#   dsh plugin --profile desktop add <abs path>/deepseek-ai-dsh-interpss-0.6.3.tgz
# Verify against the profile that actually serves the GUI (~/.dsh/profiles/desktop):
diff -q lib/client.js ~/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-interpss/lib/client.js
```

The install rewrites the profile lockfile, so **check the native bridge straight afterwards**,
before any restart — a `Packages: +1 -6` line in the output is the shape that has broken it:

```bash
cd ~/.dsh/profiles/desktop
node -e "console.log(require.resolve('java-bridge-darwin-arm64'))"
```

**Never `pnpm remove` as a routine step.** It rewrites the profile lockfile, and in
0.3.19 that rewrite dropped `java-bridge`'s optional native package for this platform
(`java-bridge-darwin-arm64`) — the next restart then failed every bridge call
with `Cannot find module 'java-bridge-darwin-arm64'`, and no in-process retry can
recover, because a failed module load is latched for the life of the process. Reach for
`remove` only when a *same-version* repack must be relinked, and repair the lockfile
afterwards:

```bash
# is the native bridge package resolvable? (name = java-bridge-<platform>)
cd /Users/mzhou/.dsh/profiles/desktop
node -e "console.log(require.resolve('java-bridge-darwin-arm64'))"

# repair: regenerate the lockfile, keeping a backup, then restart the app
cp pnpm-lock.yaml /tmp/pnpm-lock.desktop.bak
rm -f pnpm-lock.yaml
pnpm install
node -e "console.log(require.resolve('java-bridge-darwin-arm64'))"
```

## 4. Post-restart verification

**First, before packing anything** — run the client-half guard. It renders the real
`InterPssView` against a minimal React and exercises the draw.io renderer, so it catches the
two failures `node --check` cannot see: a render-time ordering error (which blanks the tab)
and a geometry regression in the diagram:

```bash
node scripts/test-interpss-client.mjs    # 312 checks; non-zero exit on failure
```

It reads `interpss-dynamic/client-body.js`,
`wspace/data/ieee/Ieee14Bus/diagram/ieee14-oneline.drawio` and the style reference
`wspace/template/oneline-diagram.drawio` directly, so it needs no build, no browser and no
dependencies. It has been verified to fail
— with `ReferenceError: Cannot access 'drawioOpen' before initialization` — when the 0.6.0
ordering defect is re-introduced, so a green run is meaningful.

Two fixture notes, both from the same rename (commit e1075429 moved the reference to
`wspace/template/oneline-diagram.drawio`, and a stray `xf10b -> bg` edge — the only one of
its 26 with neither `endArrow=none` nor `strokeColor` — was dropped from it):
- §19 (since 0.6.33) covers **preview fidelity**: `rounded` as a value (0 square, 1 rounded, a bare
  key rounded) with `arcSize` read and defaulting to 15 %, the label layout keys with draw.io's
  defaults when absent, `labelBackgroundColor` present vs null, the group cell still not being a
  shape, and the already-honoured keys unchanged beside them; then the same in the rendered SVG
  (`rx` 0 / 12 / 3, `text-anchor` start/middle/end with the `spacing` inset, the first baseline from
  the box edge with the 1.2 em step, the mask painted before the text and only where asked for).
  It also asserts the **tracked reference diagrams**: ieee14's 14 labels are masked `text` cells and
  its 14 bars are square, its legend text is anchored to its top-left, and ieee39's title is
  left-aligned in its 440-unit box.
- §11 compares the reference and the live case diagram **as parsed scenes**, not as bytes:
  draw.io re-serialises a file it opens (viewport offsets, attribute order), so byte equality
  was never going to survive a round trip through the editor.
- the case diagram must stay the reference's copy, which is what that check now says.

Since 0.6.2 §7 checks effect ordering **statically**. It parses every `React.useEffect`
dependency array out of the body and asserts each name it lists is declared textually above
that effect — the one thing the render checks cannot see, because the throwing path needs an
effect to actually run. The section numbers were **not** renumbered when 0.6.9 removed the
modal, so there is no §8 any more: it rendered that modal *open*, and §12 does the same job for
the view that replaced it. §7's mutation case now lives in the Diagram tab (a dep declared
below its effect makes it report `fileCount is declared 936 chars after the effect`); the same
mechanism caught the 0.6.0 modal defect as
`drawioRect is declared 833 chars after the effect`.
- §12 (since 0.6.8) is the render-time coverage now: it renders the **Diagram tab** idle, with
  no case, with no diagram, with a failed listing, with an open diagram and a live scene, with
  a tooltip on screen, and with the raw XML in state (there is no Source view since 0.6.34).
  Overrides are addressed
  by the view's **own** `useState` order (a fresh harness renders `DiagramView` alone, so the
  call counter starts at zero), and it proves §7 inspects the new view by requiring that
  regex to parse every one of its effects. Verified by mutation: adding a dep declared below
  its effect makes §7 report `fileCount is declared 936 chars after the effect` and §12's
  renders throw `Cannot access 'fileCount' before initialization` — the blank-tab defect,
  twice over. It also holds the **toolbar's shape**: the edit button's ancestor chain (the
  upper-right corner), that the toolbar row still ends at **Fit** and carries no edit button, and
  — since 0.6.34 — that the row carries **no view toggle of any spelling** and starts at the
  zoom-out control (the `R` / `S` letters, with `Rendered view` / `Source view` in their tooltips,
  led this row and were asserted here from 0.6.17 until the toggle was removed), and that neither the state
  (`const [view, setView]`) nor a `view === 'source'` branch survives anywhere in the tab.
- §10 asserts the shape of the tab bar's data instead of the button it lost: the host listing
  stays scoped to the case's `diagram/` folder, the action row still carries ACLF / CA /
  Report, it has **no** Diagram button, and `drawioFiles` / `drawioOpen` /
  `drawioDirectPath` are absent from the body — so re-adding a second preview surface is a
  deliberate act rather than a merge artifact.
- §13 (since 0.6.12; config-aware since 0.6.16) drives the **draw.io launcher**, the one new
  behaviour with no client-side surface to render: it slices the shared block out of the
  persistent Host, compiles it, and runs it against a fake `subprocess` provider. It asserts
  - the argv on macOS (`open -a draw.io <file>` first), the fall-through when a launcher exits
    non-zero or does not resolve, that nothing is spawned for an unavailable command, that every
    failure is reported with its own stderr, and the Windows `cmd /c start "" <file>` fallback;
  - **the config file and the code agree**: `config/ipss_plugin_env.json` parses, lists a launcher
    for each of darwin/win32/linux (each pointing at the app itself before an association), and
    normalizes to exactly `DEFAULT_DRAWIO_LAUNCHERS`;
  - the ordering rules — another OS's entries are skipped, this machine's come first and the
    untagged associations last, an unknown platform keeps file order, and the hand-written
    spellings (`macos`, `windows`, `posix`) match;
  - that a config with no usable list falls back to the defaults, and that an entry keeps only
    its string args.

  The real service exists only inside the Host, so this is as close as a dependency-free suite
  gets to the button.
- §14 (since 0.6.18) covers the **render-time voltage annotation**: the band rule (exclusive at both
  ends, blank/non-numeric never flagged), the reader (columns by header name — proved with a
  shuffled header — scene-limited answers, a header without `ID`/`VoltMag` yielding nothing,
  lowercase ids), the painting on the real IEEE 14-bus scene plus a synthetic generated-format label
  (bar fill/stroke, red label text, the white paper box preserved or absent per format, an in-band
  bus still on the theme tokens, red surviving `drawioThemeColor`), and — the constraint the whole
  design exists for — that the **parsed scene is unchanged** after an alerted render and that no
  write RPC exists anywhere in the diagram path.
- §18 (since 0.6.28) covers the **birdseye**: one subpath per bar and per branch (every bar closed,
  branch polylines followed so a hop shows in the thumbnail), an empty scene yielding empty paths, and
  the geometry — a middle click centring the window, a corner click held inside the drawing, a window
  as large as the drawing being immovable, out-of-range fractions clamped, and a missing scene or rect
  passing through untouched. §12 renders the thumbnail and asserts it carries the whole scene and the
  viewport frame, that it is absolutely positioned inside a `relative` canvas, and that its pointer
  handlers do not throw.
- §16 (since 0.6.23; the draft-preview rule since 0.6.24) covers **diagram search and filter**: that
  every edge resolves to a bus pair
  through its transformer group's sibling ring (0 of 25 unresolved on the reference scene, and each
  transformer's two stubs agree), the query forms (number, `Bus-N`, name substring, a branch as an
  `A-B` pair or between two ids -- `Bus-A -> Bus-B`, the id spelling added in 0.6.35, with ten
  spellings pinned and the id/number equivalence and reply wording asserted -- and
  the cases that must say "no match"), the bus-table fold into area/zone lists with page merging,
  the filter's hiding rules (nothing when it has no criteria; a bus by area; the band filter keeping
  exactly the flagged buses; a branch hidden when either end is; rings and their group hidden with a
  hidden stub), and the paint path itself -- a hidden cell leaves the tree, a matched bar, label and
  branch take the search colour.
- §15 (since 0.6.19) pins the **size limits and their boundary**: the preview cap is 20000 cells, both
  hosts read up to 4 MiB (4 194 304 bytes, 0.6.20 — raised 2 -> 5 MiB in 0.6.19, trimmed to 4 MiB in
  0.6.20 because the largest drawing here is ~2.9 MiB), and the generator's own self-check allows
  20000 — the three move together,
  because raising one alone would leave the others refusing the same file (Texas 2K needs all three:
  ~10.7k cells, ~3 MB). The boundary is exercised on both sides with a synthetic scene: exactly at
  the cap the parse gets past the size check (and then fails for being empty, which is the proof),
  and one cell over it fails with `20001 cells (limit 20000)`.
  - Two §3/§11 assertions were made **fixture-relative** at the same time, because a case diagram is
    a file the draw.io button invites you to edit: the group-origin check now reads the group's own
    `mxGeometry` out of the file instead of hard-coding `462,306`, and the template comparison
    compares the drawing's **inventory** (cell ids + kinds + edges) rather than its coordinates. A
    local draw.io edit that nudged transformer group 3 to `x=503` failed both before this change
    while breaking nothing the preview depends on.

Since 0.6.3 **§9 asserts the two plugins are in sync**, which is what makes this rebuild
guide trustworthy: the suite reads only the dynamic body, so silent drift had made it
describe something other than what ships. §9 requires
- `interpss-dynamic/client.js` and `client-body.js` to be **byte-identical**;
- the persistent and dynamic tab bodies to be identical once the documented timer swap is
  re-applied, with each side carrying its own timer form exactly once;
- nothing the tab body calls to be defined in the persistent-only region (the `nextCsvSort`
  trap: it was defined among the tool cards and reached the body only through hoisting);
- `index.js` and `host-body.js` to differ only in `export default {` vs `return {`;
- both hosts to declare the same `METHODS` and to carry the shared features (CSV sort, CA
  overload threshold), with `applyCsvSort` byte-identical;
- the chat tools to stay persistent-only.

Verified by mutation in both drift directions: deleting the threshold from both dynamic host
files fails with `dynamic host lacks overloadThreshold`; deleting the sort plumbing fails
with `dynamic host lacks applyCsvSort; dynamic host lacks sortColumn; dynamic host lacks
sortDesc` plus the `applyCsvSort` identity check; perturbing one character of the dynamic tab
body fails the byte-identity and body-equality checks.

Restart the Desktop app (the plugin manager reports `application: restart-required`; a page
reload alone does **not** pick up a new plugin version), then hard-reload the page. A
Client-half change is served with the plugin bundle, so the reload is what picks it up:

- Client bundle `GET /plugins/@deepseek-ai/dsh-interpss/client.js` → `200`,
  SHA-256 matches `lib/client.js`
- `POST /api/interpss/<method>` with
  `{"type":"client-request","rpcId":"x","method":"interpss/<method>","payload":{"args":{"input":{}}}}`:
  - `isActivated`, `listCases`, `getAclfOptions`, `listCaFiles`, `getCaOptions`, `runCa`, `getNetworkInfo`, `getBridgeCase` → `200`, `ok:true`
  - `listDrawioFiles` → `200`, `ok:true`, with `wspace/template/ieee14-oneline.drawio` in `files`
  - `readDrawio` with `{"path":"wspace/template/ieee14-oneline.drawio"}` → `200`, `ok:true`, non-empty `xml`; with `../etc/passwd`, an absolute path, or a non-`.drawio` name → `ok:false`
  - unknown method → `404` (proves only registered endpoints respond)

> **These two HTTP checks are written for a bare `dsh web` server and do not work as-is
> against the Desktop app.** On the Desktop surface the GUI answers on `127.0.0.1:19387`
> (not `:3080`) and both routes are closed to an unauthenticated client: `POST
> /api/interpss/<method>` returns `401 unauthorized` and `GET
> /plugins/@deepseek-ai/dsh-interpss/client.js` returns `404`. Do not spend time trying to
> work around that. Verify the Desktop install from the profile on disk instead — the
> installed `lib/client.js` and `lib/index.js` must be byte-identical to the source, the
> plugin manager must list the new version as `installed: true, enabled: true`, and
> `java-bridge-<platform>` must resolve:
>
> ```bash
> P=~/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-interpss
> shasum -a 256 $P/lib/client.js interpss-persistent/lib/client.js   # equal
> grep -m1 '"version"' $P/package.json                               # the version you packed
> (cd ~/.dsh/profiles/desktop && node -e "console.log(require.resolve('java-bridge-darwin-arm64'))")
> ```
>
> Then confirm the tab behaviour by hand in the GUI — that is the check that actually
> exercises the Client half.

- Composition row present: the plugin manager's bundle list includes
  `@deepseek-ai/dsh-interpss` with `enabled: true` (`dsh --profile desktop --dump-config`
  → `- id: interpss` when the CLI is on PATH)
- **Bridge-case mirroring**: with no simulation case loaded, `getBridgeCase`
  answers `{ ok: true, case: '' }` (never an error). Load a case from chat with
  `interpss_case_load`, then switch back to the InterPSS tab: the *Simu Case*
  picker moves to that case (preset or custom row) and shows
  `✓ Loaded: N buses, M branches` within one poll interval, without pressing Load.
  A deliberate, not-yet-loaded picker choice survives a tab switch — the
  regression symptom is a picker that silently reverts or a "✓ Loaded" line that
  disappears every time the view remounts
- **Diagram tab** (since 0.6.8): the tab bar reads **Chat · InterPSS · Diagram · Trajectory**,
  and the InterPSS action row reads **ACLF · ⚙ · CA · Report** (the 0.6.9 change). The tab opens
  straight onto its **Simu Case** row — no heading, no subtitle (0.6.10) — with a toolbar of
  controls that reads **− · [level ▾] · + · 🔍 · ▼** (`R · S` led it from 0.6.17 until 0.6.34 removed
  the view toggle, so the drawing is always shown rendered). **The level readout is the zoom picker
  since 0.6.21, and it carries Fit since 0.6.22**: a `select` labelled *Zoom level* offering 25 / 50 /
  75 / 100 / 125 / 150 / 200 / 300 / 400 % **and `Fit` as its last entry**, sitting exactly between
  `−` and `+` — which is now the end of the row, since Fit's own button is gone. A percentage picks
  that zoom about the centre of what is on screen, clamped by the same limits the wheel uses; `Fit`
  shows the whole page from its origin, and while the view is fitted the readout says **Fit** rather
  than claiming 100 % (picking 100 % only rescales about the current centre, which is a different
  view). A level reached with the wheel or a pinch (the screenshot behind this was 745 %) is listed
  as an extra entry and shown as selected, so the control never rounds the view to a preset it is
  not at — and getting back to it after picking 100 % is one click.
  - **Search and Filter (0.6.23)** are the two icon buttons after the zoom controls; each opens a
    dialog whose **OK** applies and whose **Cancel** only closes (the fields are a draft, and the
    applied value is written by OK alone, so Cancel really cancels).
    - **Search the diagram** takes a bus number (`1001`), a bus id (`Bus-1001`), part of a case bus
      name (`ODESSA`), or a branch written with an arrow (`1001->1002` since 0.6.25, and also with
      its ends as ids — `Bus-1 -> Bus-2` — since 0.6.35; `-`, `/` and the unicode arrow still work,
      and each id's hyphen and spacing are optional, so `bus1->bus2` and `1 -> Bus-2` mean the same
      pair). A branch reply names the buses as ids whichever spelling was typed
      (`3 branches between Bus-1 and Bus-2.`). Its placeholder and help are **about the case in
      front of it**: the bus count and range the diagram draws, a branch example from its own bus
      ids, and a name
      from its own table -- or, when the case has no result table, a statement that names cannot be
      searched (rather than a suggestion that cannot work). Matches are
      repainted in the search green `#2EA043` since 0.6.36 — bar, label text and branch (a thicker
      line), the blue `#1F6FEB` before that, which the birdseye's viewport frame still wears — the
      toolbar shows
      a `N buses, M branches` count, and the bus table is fetched for the names only when the dialog
      opens. A match outranks the violation red; the tooltip still reports the violation.
    - **Filter the diagram** keeps one **area** and/or one **zone** (lists read from the case's bus
      table, the zone list scoped to the chosen area) and/or only the buses outside the 0.9–1.1 pu
      band. Everything else is **hidden** — bar, label, its branches *and* the transformer symbols on
      them — so nothing is left dangling into nothing. The funnel button stays lit while a filter is
      applied, and the status text (`filter: area 5`, `3 buses ✕`) clears the search and the filter.
    - Both are paint-time overrides of the same kind as the voltage alert: `hidden` skips a cell,
      `paint` recolours one, and the `.drawio`, the parsed scene and the desktop app see neither.
  - **The birdseye view (0.6.28)** is a thumbnail of the whole drawing in the canvas's bottom-right
    corner, with the visible rectangle drawn on it — at 200 % on a 2000-bus drawing there is otherwise
    nothing to say where you are. It is deliberately **not** a second `DrawioDiagram` (that would
    double the DOM of a 10k-cell scene): `drawioBirdseyePaths` flattens the scene into **two** `<path>`
    strings, one for every branch and one for every bar, which the browser paints as one shape each
    (measured on the 2000-bus Texas 2K scene: 2 ms, 180 KB of path data, 2 DOM elements). The
    viewport frame is a real `rect` on top, `vectorEffect="non-scaling-stroke"` keeps every line
    visible at thumbnail scale, and clicking or dragging the thumbnail moves the view
    (`drawioBirdseyeRect` centres the same-size window and holds it inside the drawing). The
    thumbnail captures its own pointer events and stops them, so dragging it never pans the canvas
    underneath.
  - **The gear, and `config/net_diagram.json` (0.6.26)**. A gear button beside the draw.io button
    opens a dialog for the diagram's **flag thresholds and colours** (and, since 0.6.29, the **birdseye
    switch**), read and written through
    `getNetDiagramOptions` / `saveNetDiagramOptions` (Host, workspace-level file). Three families
    are painted from the case's own tables, keyed by cell id in one map that the renderer applies
    (`paint`):
    - **bus flags** — `VoltMag` outside `Bus_flag_lower_limit .. Bus_flag_upper_limit`, in
      `Bus_flag_color` (`red` by default), on the bar *and* its `Bus-N` label text;
    - **base-case branch flags** — pairs whose highest `Loading%` reaches
      `Basecase_branch_flow_flag_percent` (`green` by default);
    - **the birdseye switch** (`Show_birdseye_view`, a checkbox in the dialog's *View* group) turns the
      thumbnail off and on; it is on unless it was explicitly turned off, and the canvas simply does not
      render the overlay rather than hiding it with CSS;
    - **contingency branch flags** — pairs whose worst `LoadingPercent` in the CA result table (`checkResult`
      must list `_DF_contingency.csv`: that list is the only way the tab finds a result file, and leaving it out
      made the whole family silently invisible until 0.6.31)
      reaches `Contingency_branch_flow_flag_percent` (`blue` by default), and a contingency flag
      outranks a base-case one on the same branch.
    A search's green still outranks every flag, because a search is the deliberate act. The dialog's
    form is a draft (OK saves, Cancel cancels); the Host sanitizes again on save, merges over what
    is on disk (unknown keys survive) and never writes an out-of-range value. Flags are a **preview**
    concern: no colour reaches the `.drawio`, so the desktop app and the PNG stay plain.
      The two hard parts are pure and pinned in §16: an edge through a transformer is *two* stubs
      (`bus → ring`), so the bus pair comes from the group's sibling ring — every edge must resolve,
      or those branches could never be searched or filtered — and a filter needs the area/zone
      columns by **header name**, like the voltage columns. Selecting a
  case in the InterPSS tab (preset or custom row) and switching to *Diagram*
  draws that case's `<case>/diagram/*.drawio` full-size; with several files the picker lists
  them and reopens the one last viewed; a case with none says so instead of drawing an empty
  pane, and a case never touched shows the InterPSS preset's diagram. Hovering a bar or a
  branch shows the connection diagram's tooltip (without a result table it says
  `no result data — run ACLF`), and a branch's tooltip ends with its flow loadings since 0.6.30 —
  `Basecase Loading(%): …` from the branch table's own `Loading%` (the field the base-case flags
  compare against), plus `Contingency Loading(%): …` when the CA result table lists that branch
  (which it only does at or above the CA's `overloadThreshold`). The wheel zooms about the cursor,
  dragging pans, **Fit** resets, and **Source** shows the raw file. Loading a case from chat moves this tab too —
  the regression symptom is a Diagram tab that keeps drawing the previous case.
  **Since 0.6.18 a bus whose `|V|` is outside 0.9–1.1 pu is red** (bar, outline and `Bus-N`), and
  hovering it adds `⚠ |V| outside 0.9–1.1 pu` to its tooltip. The check is
  `Ieee14Bus_LargeLoadQ` (Bus-14 = 0.8714): exactly one red bar, the other thirteen grey — and
  `git status` must still show **no** modification to any `.drawio`, because the annotation is
  paint-time only. A case with no ACLF results (or in-band voltages, e.g. `Ieee118Bus` and
  `ieee39`) shows no red at all, which is not an error.
  **Since 0.6.12 the draw.io-marked button opens the same file in the local draw.io desktop
  app**; which executable that is comes from `config/ipss_plugin_env.json` (0.6.16), so on macOS
  it is `open -a draw.io` and on a Windows or Linux box it is whatever that file names. It is at
  the right end of the **Simu Case** header row
  (the tab's upper-right corner, 0.6.15), so it is on screen next to the drawing without
  scrolling: a second or two later the app shows
  the diagram, the tab prints `Launched draw.io (open -a draw.io)` to the button's left, and a failure prints the
  Host's reason (`Could not launch draw.io: could not launch the local draw.io app (… exited 1:
  …)`) instead of an empty pane — a malformed `drawio.launchers` also warns there that the
  built-in launchers were used. This is the only part of the plugin that needs a **Host**
  restart to appear — every other change in this guide is Client-half and reloads
- **CA dialog** (since 0.3.16): with the Texas 2K case selected and no
  `config/ca_run.json`, pressing **CA** opens *Run Contingency Analysis* pre-filled with
  `2k_contingencies_115kVAbove.json` (2359) and `2k_monitored_branches.json`
  (1308) and their green count lines. **OK** writes
  `wspace/data/psse/Texas2K/config/ca_run.json` (four keys), closes the dialog, runs CA
  (the CA info tab shows the summary) and rewrites `*_DF_contingency.csv`;
  **Cancel** writes nothing and runs nothing. Deleting the file and reopening the
  dialog reproduces the discovery defaults — the regression symptom is an empty
  or `all`/`all` dialog for a case that has companion JSON files.
- **Chat tools**: the tool registry lists `interpss_case_load`,
  `interpss_network_info`, `interpss_run_aclf`, `interpss_case_summary`, `interpss_run_gvy` and
  `interpss_run_ca`, and the
  plugin's `$TMPDIR/dsh-interpss-diagnostic.log` contains
  `chat tools registered: interpss_case_load, interpss_network_info, interpss_run_aclf, interpss_case_summary, interpss_run_gvy, interpss_run_ca`
  and `tools=true`. In an iPSS Agent workspace:
  - a chat call with no argument returns the case selected in the InterPSS tab
    (result `source: selection`) — select a case **without** pressing Load first
    to prove the selection path rather than the bridge path;
  - `interpss_run_aclf` converges a small case, and its
    `wspace/<case dir>/result/` CSVs and `_network_info.txt` are rewritten.
- **Case load**: `interpss_case_load` with no argument reports the selected case
  with `alreadyLoaded: false` and its bus/branch counts the first time, and
  `alreadyLoaded: true` on an immediate second call (no re-parse). Selecting a
  different case and calling it again loads that case.
- **Result explorer**: the settled `interpss_run_aclf` card shows an
  *Explore results* row with Bus / Branch / Gen / Load; each opens a paged table
  (`N of M rows`) that appends the next 100 rows when scrolled to the bottom —
  the same 40 px threshold as the tab, with a ref gating the in-flight fetch so a
  burst of scroll events cannot append a page twice. A failed run, a replayed
  pre-0.3.2 log, or an errored card falls back to the generic tool row.
- **Report button**: the button next to Load generates
  `wspace/<case dir>/result/AC_Loadflow_Report.md` and opens it in the file
  surface — even for a case that also has a contingency CSV (the point of the
  explicit `reportType`).
- **Case summary**: `interpss_case_summary` renders no card for any scope (0.3.12) — the
  tool call appears with no output row at all. Its result is what the chat report uses:
  no arguments gives the case totals (no rows); `{ scope: "bus", numRec: 5 }` gives five
  lowest-voltage rows and `{ scope: "bus", sortRule: "Highest Bus Voltage" }` five highest;
  an unknown scope fails instead of silently summarizing `net`.
- **Groovy script tool** (0.3.17+, needs the rebuilt uber JAR; 0.3.18 also accepts a `wspace/data/…` selector): with the IEEE 14 case,
  `interpss_run_gvy({ script: "ieee14_adjBus14.gvy", case: "IEEE 14-bus" })` reports
  `load 259.00 → 262.10 MW (+3.10)` and renders its card; a second call without `reload`
  compounds the edit, `reload: true` resets it; `ieee14_adjBranch1_2.gvy` takes
  Bus1→Bus2(1) out of service; a script with a typo fails with the property name and
  `script line N`; a script outside `data/…/scripts/` is rejected with the available
  `.gvy` names. A following `interpss_run_aclf` converges and its CSVs show the edit.
- **Short-result cards**: the settled `interpss_case_load`,
  `interpss_network_info` and `interpss_case_summary` cards show their summary text directly, with no expand
  toggle to click — the symptom of a missing card here is a summary visible only
  after expanding a generic row. The summary tool is the exception: since 0.3.12 no
  `interpss_case_summary` call renders a card (ranked scopes since 0.3.11), so any visible card for
  it — totals or top-N table — is the regression symptom.
