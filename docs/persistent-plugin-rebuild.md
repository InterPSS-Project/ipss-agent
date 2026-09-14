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
  }
});
```

## 2. Host (`lib/index.js`)

Keep the persistent architecture — it is the `javaBridge` **provider** and the
registrar of the browser-facing `/api` endpoints (the dynamic host consumes
`javaBridge` and uses `harness.handle`; it cannot be used verbatim). Ensure:

- `inject: ['typert']` on the default export (else `apply()` runs before the
  typert registry and `/api` endpoints silently 404)
- `METHODS` matches the dynamic list (14): `isActivated, checkResult,
  checkResultFiles, listCases, readCsv, busConnections, runAclf, runCa,
  runReport, getAclfOptions, saveAclfOptions, loadCase, summarizeResult,
  getNetworkInfo`
- `readCsv` whitelist includes `contingency`: `_DF_(bus|branch|gen|load|contingency)\.csv`
- `javaBridge` provider exposes `runAclf`, `runContingency`, `runReport`,
  `loadCase`, `summarize`, `getNetworkInfo`, `caseInfo`, and `javaLauncher()`
  (the resolved `java` path consumed by the dynamic plugin's CLI fallback).
  `caseInfo(format, absCase)` returns the network info of a case, loading it only
  when the embedded JVM does not already hold it; the module-level `lastLoadedAbs`
  mirrors `IpssAgentBridge.loadedInput` (set by `loadCase`, `runAclf`, and
  `runContingency`) so a converged load flow is reused rather than discarded
- **Chat tools**: `apply()` registers every definition in `chatToolDefs`
  (`networkInfoTool(ctx)`, `runAclfTool(ctx)`) on the host tool registry via
  `ctx.effect(() => tools.register(...))`, guarded by `ctx.get('tools')` (the row
  only injects `typert`) with a `diag()` line either way. `METHODS` is unchanged —
  tools add no `/api` endpoint
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

**Always bump a minor version before packing** (e.g. `0.3.1` → `0.3.2` in
`package.json`). Each rebuild must ship a new version so the install picks up
the fresh tarball instead of a cached older package.

```bash
cd interpss-persistent
# bump version first, e.g. 0.3.1 → 0.3.2
node --check lib/index.js && node --check lib/client.js
rm -f deepseek-ai-dsh-interpss-0.3.2.tgz
npm pack --cache /tmp/npm-cache-fresh     # sole distributable (no zip)

# tarball == source
tar -xzf deepseek-ai-dsh-interpss-0.3.2.tgz -C /tmp/pkgv
diff -q lib/index.js  /tmp/pkgv/package/lib/index.js
diff -q lib/client.js /tmp/pkgv/package/lib/client.js

# reinstall
cd /Users/mzhou/.dsh/profiles/web
pnpm remove @deepseek-ai/dsh-interpss
dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-0.3.2.tgz
diff -q <source lib/client.js> ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-interpss/lib/client.js
```

## 4. Post-restart verification

Restart `dsh web` on :3080, then hard-reload the page (a Client-half change is
served with the plugin bundle, so the reload is what picks it up):

- Client bundle `GET /plugins/@deepseek-ai/dsh-interpss/client.js` → `200`,
  SHA-256 matches `lib/client.js`
- `POST /api/interpss/<method>` with
  `{"type":"client-request","rpcId":"x","method":"interpss/<method>","payload":{"args":{"input":{}}}}`:
  - `isActivated`, `listCases`, `getAclfOptions`, `runCa`, `getNetworkInfo` → `200`, `ok:true`
  - unknown method → `404` (proves only registered endpoints respond)
- Composition row present: `dsh --profile web --dump-config` → `- id: interpss`
- **Chat tools**: the tool registry lists `interpss_network_info` and
  `interpss_run_aclf`, and the plugin's `$TMPDIR/dsh-interpss-diagnostic.log`
  contains `chat tools registered: interpss_network_info, interpss_run_aclf` and
  `tools=true`. In an iPSS Agent workspace:
  - a chat call with no argument returns the case selected in the InterPSS tab
    (result `source: selection`) — select a case **without** pressing Load first
    to prove the selection path rather than the bridge path;
  - `interpss_run_aclf` converges a small case, and its
    `wspace/<case dir>/result/` CSVs and `_network_info.txt` are rewritten.
- **Result explorer**: the settled `interpss_run_aclf` card shows an
  *Explore results* row with Bus / Branch / Gen / Load; each opens a paged table
  (`N of M rows`, Load more). A failed run, a replayed pre-0.3.2 log, or an
  errored card falls back to the generic tool row.
