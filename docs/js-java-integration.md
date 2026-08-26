# Node.js 与 InterPSS Java Library 集成方案

## Goals

1. Replace today’s Host shell-out to `IpssCmd` (`java -cp … org.interpss.agent.IpssCmd aclf …`) with an **in-process bridge** (`java-bridge`) so Node can call Java without spawning a new JVM per run.
2. Keep the loaded `AclfNetwork` **long-lived** for the Host process lifetime, held in a `SimuModelRepository` (base-case cache). Clearing the reference allows GC; otherwise the net stays in memory for reuse (reload-free second run, in-memory summarize).

## Current state (as-is)


| Layer                                  | Behavior                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Host (`interpss-dynamic/host-body.js`) | `runAclf` builds classpath (`target/classes` + `lib/ipss_runnable.jar` + `lib/deps/*`) and shells `IpssCmd` with ~180s timeout |
| `IpssCmd`                              | One-shot `main()`: load → ACLF → write CSV / network_info → exit                                                               |
| `NetworkLoader`                        | Supports **ieee** and **psse** (not IEEE-only)                                                                                 |
| `SimuModelRepository` (agent)          | Base-case get/set only; **not wired** into runners yet                                                                         |


`IpssCmd` as a CLI entrypoint is not the in-process API. Host needs a **library facade**, not `main()`.

## Approach: In-Process Bridge (`java-bridge`)

Embed a JVM inside the Node (Cordis Host) process. Node calls Java like local functions; best latency, shared heap for the cached network.

**Trade-off:** a JVM or native crash can take down the whole Host process.

### Library basics

1. **Start JVM** — `ensureJvm` (e.g. `-Xmx4g` for large RAW cases). In packaged Electron hosts, set `isPackagedElectron: true` and unpack `java-bridge` native binaries from asar.
2. **Classpath** — `appendClasspath` with the same layout Host uses today, **or** the Uber JAR from `IpssCmd.md` (`target/ipss-agent-cmd-*-uber.jar`). Prefer one documented layout; expand `lib/deps/*.jar` explicitly if wildcards are unsupported.
3. **Call style** — every Java method gets Sync (`fooSync`) and async (`foo`). **Host must use async** for load/run so the Cordis event loop is not blocked.
4. **Exceptions** — Java exceptions surface as JS `Error` with `cause`.
5. **Runtime** — JRE/JDK required; on Windows also VC++ Redistributable 2015+.

---



## Design principles

1. **Java owns the network** — Node never traverses EMF/`AclfNetwork`; only strings, JSON, and filesystem paths cross the bridge.
2. **One facade** — `org.interpss.agent.bridge.IpssAgentBridge` (name TBD). Host does not import adapters/runners piecemeal.
3. **Host response compatibility** — keep existing `runAclf` return shape (`ok`, `networkInfo`, `files`, `resultDir`, …) so Client UI need not change in phase 1.
4. **Filesystem conventions stay** — `wspace` paths, `aclf_run.json` resolution, writing `result/*_DF_*.csv` remain Java-side (or Host-resolved absolute paths passed in). In-process does not remove those conventions.
5. **Out of scope for phase 1** — CA, adjust/compare, replacing Python `runReport`, exposing adapters to JS.

---



## Java facade (minimal API)

```java
// Phase 1: one repo per JVM (Host process).
// Phase 2: Map<sessionId, SimuModelRepository> if multi-session Host.
public final class IpssAgentBridge {
  private final SimuModelRepository repo = new SimuModelRepository();

  /** Load ieee|psse into base-case cache. Does not run LF. */
  public String loadCase(String format, String absoluteCasePath);

  /**
   * Run ACLF on cached base (or load+run if path given).
   * Writes CSV under resultsDir. Uses absoluteConfigPath like ProjectPaths.
   */
  public String runAclf(String format, String absoluteCasePath,
                        String absoluteConfigPath,
                        String absoluteResultsDir, String stem);

  /** In-memory summary from cached net (MCP-style). No file I/O required. */
  public String summarize(String scope, String sortRule, int numRec);

  /** IpssNetworkInfo.format on cached base. */
  public String getNetworkInfo();

  public void clear();
}
```

All return values are **JSON strings** (or plain text for `networkInfo`) so `java-bridge` stays simple.


| Method      | Success payload (sketch)                                  |
| ----------- | --------------------------------------------------------- |
| `loadCase`  | `{ ok, format, input, busCount, branchCount }`            |
| `runAclf`   | `{ ok, converged, networkInfo, files: [...], resultDir }` |
| `summarize` | `{ ok, scope, text }` (or structured rows)                |


**Internals reuse:** `NetworkLoader`, `AclfRunConfigRec` / config apply, existing `AclfRunner` logic (factor “run on net + write CSV” away from CLI-only entry), `IpssNetworkInfo`. Summarize can follow MCP’s `AclfResultAdapter` / scope enums (`Net`, `Bus`, `Gen`, `Load`, `Branch`).

**Repository:** keep agent `SimuModelRepository` base-case API for phase 1; when adjust/compare is needed, align with MCP (`createChangeCase` + `jsonCopy()`).

**Concurrency:** one lock/queue around load/run/summarize on the same repo so concurrent Host RPCs cannot race.

---



## Node bootstrap (once per Host process)

```js
const { ensureJvm, appendClasspath, importClass } = require('java-bridge')

await ensureJvm({ opts: ['-Xmx4g'] /* , isPackagedElectron: true if needed */ })
appendClasspath([
  root + '/target/classes',
  root + '/lib/ipss_runnable.jar',
  // …or Uber JAR; expand lib/deps/*.jar as needed
])
const Bridge = await importClass('org.interpss.agent.bridge.IpssAgentBridge')
const bridge = await Bridge.newInstanceAsync() // or static getInstance()
```

---



## Host RPC mapping


| Today / new                          | In-process behavior                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `runAclf`                            | Resolve abs paths → `bridge.runAclf(...)` **async** → same `{ ok, networkInfo, files, … }` |
| `loadCase` *(new)*                   | `bridge.loadCase(format, absPath)` — cache only                                            |
| `summarizeResult` *(new)*            | `bridge.summarize(scope, sort, n)` — requires prior load/run                               |
| `readCsv` / `checkResult*`           | Unchanged (FS)                                                                             |
| `runReport`                          | Unchanged (Python)                                                                         |
| `getAclfOptions` / `saveAclfOptions` | Unchanged (JSON on disk; pass config path into `runAclf`)                                  |


Suggested `METHODS` addition: `'loadCase', 'summarizeResult'` (keep `'runAclf'`).

`runAclf` **compat path:**

1. Resolve workspace root, `wspace`, case abs path, config (same two-tier rules as `ProjectPaths.resolveAclfRunConfig`), results dir + stem.
2. Call bridge async (never `*Sync` for LF).
3. Optionally `reuse: true` skips reload when bridge already holds that case path (store `loadedInput` on the bridge).

---



## Session / state


| Phase | Model                                                                                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | One `SimuModelRepository` per Host JVM; `loadCase` replaces base. Document “one active case”. Enough for typical single-workspace Cordis use. |
| **2** | Key by`workspaceRoot` if multiple sessions share the Host; pass id into every bridge call.                                                    |


---



## Acceptance criteria

1. First `runAclf` on ieee118 matches current CSV + `network_info` output.
2. Second run with reuse / `loadCase` then `runAclf` does not re-parse the case file.
3. `summarizeResult({ scope: 'Bus', sort_rule: 'Lowest Bus Voltage', num_rec: 10 })` works with no shell.
4. Existing Client UI still works with current `runAclf` response fields.

---



## Suggested implementation order

1. Add `IpssAgentBridge` + wire `SimuModelRepository`; factor `AclfRunner` for in-process use (CLI `IpssCmd` can keep calling the same core).
2. Host: JVM init once; switch `runAclf` to bridge; keep return shape.
3. Add `loadCase` / `summarizeResult` RPCs.
4. (Later) CA, change-case adjust/compare, multi-session map.



## Explicitly not in phase 1

- Direct JS access to `IeeeFileAdapter` / `AclfNetwork`
- Sync ACLF on the Cordis event loop
- Contingency analysis via bridge
- Replacing Python NERC report generation
- Decision to abandon process isolation entirely for production crash resilience (document risk; sidecar remains a future fallback)

