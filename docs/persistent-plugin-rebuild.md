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
keeps the persistent-only tool-card section, all five `slots.inject`
registrations, and the module footer intact — copying only up to
`const slots` drops the tool cards, and diffing the result against the previous
`lib/client.js` should show your UI change alone.

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
- `METHODS` matches the dynamic list (20): `isActivated, checkResult,
  checkResultFiles, listCases, readCsv, busConnections, runAclf, runCa,
  runReport, getAclfOptions, saveAclfOptions, listCaFiles, getCaOptions,
  saveCaOptions, loadCase, summarizeResult, getNetworkInfo, getBridgeCase,
  listDrawioFiles, readDrawio`
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
  name. A diagram belongs to a case and the tab's Diagram button is enabled by this answer
  alone, so an **absent case or folder is an empty list, not an error** ("this case has no
  diagram yet" is a state the tab renders); a malformed case path *is* an error. 0.6.1–0.6.5
  instead walked the whole workspace through `scanDrawio` (skipping `node_modules`, `.git`,
  `target`, `build`, `logs`, `temp`, `.venv`, `.mvn`, `.npm-cache-local` and the local
  backup, capped at depth 6 and 200 files); that scanner and its constants are **gone**, and
  the guard asserts neither host still carries them. `readDrawio` is unchanged: it takes a
  **workspace-relative** `.drawio` path — not the `data/…` form `readCsv` uses — and rejects
  `..`, any non-`.drawio` name and anything over `MAX_DRAWIO_BYTES` (2 MiB) *before* reading,
  so an oversized file never reaches the RPC payload. `MAX_DRAWIO_BYTES` and `readDrawio` are
  byte-identical in the persistent Host and the two dynamic ones.
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
- **Diagram preview** (Client half, since 0.6.1): the **Diagram** button in the action row
  opens one modal that hosts both the `.drawio` picker and the preview, so no second popover
  is needed. **Since 0.6.6 the button is gated by the selected case's `diagram/` folder and
  nothing else**: `refreshCaseDiagrams` re-reads `listDrawioFiles` on every case-selection
  change (it rides `onCaseChanged`, which already runs on mount and on each picker/select
  edit), stores the answer in `drawioFiles`, and the button derives both its `disabled` state
  and its tooltip from that one fact — so the button and the picker list cannot disagree, and
  `diagramSeq` drops an answer that belongs to a case the user has already moved off. A case
  with **exactly one** diagram opens it directly, skipping the picker entirely
  (`drawioDirectPath`, a pure module-level helper the guard exercises); several open the
  picker, which re-reads the folder on open so a diagram dropped in while the tab is open
  shows up. It is deliberately *not* gated on `caseLoaded`: the diagrams exist per case, not
  per solved case.
  `openDrawio(path)` reads the file through `interpss/readDrawio`, decodes it with
  `diagramXmlFrom`, and renders it with `parseDrawioScene` + `DrawioDiagram` as inline SVG
  with a Rendered / Source toggle. The renderer is **self-contained and offline on purpose**:
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
  Escape is handled by the focused overlay's own `onKeyDown`, not a `window` listener, so
  this adds **no** second divergence between the two tab bodies (see §1.3)
- **Diagram pan / zoom / fit** (Client half, since 0.6.2): the rendered pane is one SVG
  whose `viewBox` moves, so a zoom step re-parses nothing. `drawioRect` is the visible
  rectangle in scene coordinates (`null` = fit, which is simply the scene's own viewBox);
  the wheel zooms about the cursor and dragging pans. The cursor anchor is computed through
  the box `preserveAspectRatio="xMidYMid meet"` actually draws — the smaller of the two
  ratios, centred — because using the element's own box would let the anchor drift as the
  pointer moves off centre. The wheel listener is registered natively with
  `{ passive: false }` rather than through `onWheel`: React delegates wheel passively, so
  `preventDefault` would be ignored and the page behind the modal would scroll while
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
    enhancement and must never error or block the preview. The tip is dropped when the modal
    closes, and a late `busConnections` answer is applied only if that bus is still under the
    cursor. Guard §11 covers the pairing (all 25 edges resolve, and the 20 resolved pairs agree
    with the result table), the hit areas, the wiring and the tooltip wording.
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
pnpm pack --pack-destination .     # npm pack where npm is on PATH; sole distributable (no zip)

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
node scripts/test-interpss-client.mjs    # 124 checks; non-zero exit on failure
```

It reads `interpss-dynamic/client-body.js` and `wspace/template/ieee14-oneline.drawio`
directly, so it needs no build, no browser and no dependencies. It has been verified to fail
— with `ReferenceError: Cannot access 'drawioOpen' before initialization` — when the 0.6.0
ordering defect is re-introduced, so a green run is meaningful.

Since 0.6.2 §7 checks that ordering **statically** and §8 renders the modal *open*:
- §7 parses every `React.useEffect` dependency array out of the body and asserts each name
  it lists is declared textually above that effect — the one thing the render checks cannot
  see, because the throwing path needs an effect to actually run. Verified against a mutated
  body with the 0.6.2 wheel effect moved above `drawioRect`: §7 reports
  `drawioRect is declared 833 chars after the effect`, and the §1 render checks reproduce the
  `ReferenceError` and blank tab.
- §8 overrides state **by name** (parsed out of the body, not by call index) to render
  `drawioOpen: true` with a real parsed scene and asserts the zoom toolbar, the 100% readout
  and a `DrawioDiagram` child carrying that scene and a `view` prop. Without it the modal
  body is never rendered by any check — `drawioOpen` starts `false` — so a reference error in
  the toolbar would ship as another blank tab. Verified against a body whose toolbar calls an
  undefined helper: §8 fails with `ReferenceError: drawioZoomPercentTYPO is not defined`.

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
