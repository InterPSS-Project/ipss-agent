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
  `loadCase`, `summarize`, `getNetworkInfo`

## 3. Pack, install, verify

```bash
cd interpss-persistent
node --check lib/index.js && node --check lib/client.js
rm -f deepseek-ai-dsh-interpss-0.2.0.tgz
npm pack --cache /tmp/npm-cache-fresh     # sole distributable (no zip)

# tarball == source
tar -xzf deepseek-ai-dsh-interpss-0.2.0.tgz -C /tmp/pkgv
diff -q lib/index.js  /tmp/pkgv/package/lib/index.js
diff -q lib/client.js /tmp/pkgv/package/lib/client.js

# reinstall
cd /Users/mzhou/.dsh/profiles/web
pnpm remove @deepseek-ai/dsh-interpss
dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-0.2.0.tgz
diff -q <source lib/client.js> ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-interpss/lib/client.js
```

## 4. Post-restart verification

Restart `dsh web` on :3080, then:

- Client bundle `GET /plugins/@deepseek-ai/dsh-interpss/client.js` → `200`,
  SHA-256 matches `lib/client.js`
- `POST /api/interpss/<method>` with
  `{"type":"client-request","rpcId":"x","method":"interpss/<method>","payload":{"args":{"input":{}}}}`:
  - `isActivated`, `listCases`, `getAclfOptions`, `runCa`, `getNetworkInfo` → `200`, `ok:true`
  - unknown method → `404` (proves only registered endpoints respond)
- Composition row present: `dsh --profile web --dump-config` → `- id: interpss`
