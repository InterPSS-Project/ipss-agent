# Persistent InterPSS Plugin — Rebuild Guide

Rebuild `@deepseek-ai/dsh-interpss` (`interpss-persistent/`) **from the dynamic
plugin** (`interpss-dynamic/`) so both deliver identical behavior/UI.

## 1. Client (rebuild `lib/client.js` from `interpss-dynamic/client-body.js`)

Wrap the dynamic body in the persistent module loader, with two substitutions:

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

Mechanically, only the **tab body** changes between rebuilds: splice the dynamic
file's region from `    const PRESETS = [` up to (excluding) its
`    const slots = ctx.get('slots')` into the persistent file between the
transport block and the `    // --- ACLF tool-card result explorer` section. That
keeps the persistent-only tool-card section, all five `slots.inject`
registrations, and the module footer intact — copying only up to
`const slots` drops the tool cards, and diffing the result against the previous
`lib/client.js` should show your UI change alone.

## 2. Host (`lib/index.js`)

Keep the persistent architecture — it is the `javaBridge` **provider** and the
registrar of the browser-facing `/api` endpoints (the dynamic host consumes
`javaBridge` and uses `harness.handle`; it cannot be used verbatim). Ensure:

- `inject: ['typert']` on the default export (else `apply()` runs before the
  typert registry and `/api` endpoints silently 404)
- `METHODS` matches the dynamic list (17): `isActivated, checkResult,
  checkResultFiles, listCases, readCsv, busConnections, runAclf, runCa,
  runReport, getAclfOptions, saveAclfOptions, listCaFiles, getCaOptions,
  saveCaOptions, loadCase, summarizeResult, getNetworkInfo`
- `readCsv` whitelist includes `contingency`: `_DF_(bus|branch|gen|load|contingency)\.csv`
- **CA run config** (since 0.3.16): the case-folder `ca_run.json` is resolved by
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
  `aclf_run.json` (else `config/aclf_run.json`) and
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
# bump version first, e.g. 0.3.19 → 0.3.20
node --check lib/index.js && node --check lib/client.js
rm -f deepseek-ai-dsh-interpss-0.3.20.tgz
npm pack --cache /tmp/npm-cache-fresh     # sole distributable (no zip)

# tarball == source
tar -xzf deepseek-ai-dsh-interpss-0.3.20.tgz -C /tmp/pkgv
diff -q lib/index.js  /tmp/pkgv/package/lib/index.js
diff -q lib/client.js /tmp/pkgv/package/lib/client.js

# reinstall — a NEW version only needs `add`; do not `pnpm remove` first
cd /Users/mzhou/.dsh/profiles/web
dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-0.3.20.tgz
diff -q <source lib/client.js> ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-interpss/lib/client.js
```

**Never `pnpm remove` as a routine step.** It rewrites the profile lockfile, and in
0.3.19 that rewrite dropped `java-bridge`'s optional native package for this platform
(`java-bridge-darwin-arm64`) — the next `dsh web` restart then failed every bridge call
with `Cannot find module 'java-bridge-darwin-arm64'`, and no in-process retry can
recover, because a failed module load is latched for the life of the process. Reach for
`remove` only when a *same-version* repack must be relinked, and repair the lockfile
afterwards:

```bash
# is the native bridge package resolvable? (name = java-bridge-<platform>)
cd /Users/mzhou/.dsh/profiles/web
node -e "console.log(require.resolve('java-bridge-darwin-arm64'))"

# repair: regenerate the lockfile, keeping a backup, then restart dsh web
cp pnpm-lock.yaml /tmp/pnpm-lock.web.bak
rm -f pnpm-lock.yaml
pnpm install
node -e "console.log(require.resolve('java-bridge-darwin-arm64'))"
```

## 4. Post-restart verification

Restart `dsh web` on :3080, then hard-reload the page (a Client-half change is
served with the plugin bundle, so the reload is what picks it up):

- Client bundle `GET /plugins/@deepseek-ai/dsh-interpss/client.js` → `200`,
  SHA-256 matches `lib/client.js`
- `POST /api/interpss/<method>` with
  `{"type":"client-request","rpcId":"x","method":"interpss/<method>","payload":{"args":{"input":{}}}}`:
  - `isActivated`, `listCases`, `getAclfOptions`, `listCaFiles`, `getCaOptions`, `runCa`, `getNetworkInfo` → `200`, `ok:true`
  - unknown method → `404` (proves only registered endpoints respond)
- Composition row present: `dsh --profile web --dump-config` → `- id: interpss`
- **CA dialog** (since 0.3.16): with the Texas 2K case selected and no
  `ca_run.json`, pressing **CA** opens *Run Contingency Analysis* pre-filled with
  `2k_contingencies_115kVAbove.json` (2359) and `2k_monitored_branches.json`
  (1308) and their green count lines. **OK** writes
  `wspace/data/psse/Texas2K/ca_run.json` (four keys), closes the dialog, runs CA
  (the CA info tab shows the summary) and rewrites `*_DF_contingency.csv`;
  **Cancel** writes nothing and runs nothing. Deleting the file and reopening the
  dialog reproduces the discovery defaults — the regression symptom is an empty
  or `all`/`all` dialog for a case that has companion JSON files.
- **Chat tools**: the tool registry lists `interpss_case_load`,
  `interpss_network_info`, `interpss_run_aclf`, `interpss_case_summary` and `interpss_run_gvy`, and the
  plugin's `$TMPDIR/dsh-interpss-diagnostic.log` contains
  `chat tools registered: interpss_case_load, interpss_network_info, interpss_run_aclf, interpss_case_summary, interpss_run_gvy`
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
