# InterPSS Chat Tools

The persistent DSH plugin (`@deepseek-ai/dsh-interpss`) registers model **Tools**, so the
InterPSS capability is reachable from the chat agent and not only from the InterPSS tab.
This document covers what each tool accepts, what it returns, how its card renders, and how
the tools relate to the tab, the `/api` RPCs, and the agent skills.

Reference implementation: `interpss-persistent/lib/index.js` (Host) and
`interpss-persistent/lib/client.js` (Client). Current version: **0.6.16**.

## Tool surface

| Tool | Purpose | Side effects |
| --- | --- | --- |
| `interpss_case_load` | Load the selected case into the embedded bridge | Parses the case file when the bridge does not already hold it; no-op otherwise |
| `interpss_network_info` | Show the network information of a simulation case | Loads the case into the embedded JVM when it is not already held |
| `interpss_run_aclf` | Run an AC load flow (ACLF) and report convergence | Writes `<stem>_DF_{bus,branch,gen,load}.csv` and `<stem>_network_info.txt` under `wspace/<case dir>/result/` |
| `interpss_case_summary` | Summarize the bridge-held case: net totals, or a top-N ranking by scope | None — reads the in-memory model |
| `interpss_run_ca` | DC contingency analysis (N-1 screening) with the CA dialog bypassed, and report the overload summary | Writes `<stem>_DF_contingency.csv` under `wspace/<case dir>/result/` |
| `interpss_run_gvy` | Apply Groovy to the bridge-held case — a `.gvy` file from the case folder's `scripts/` directory, the source itself (0.4.9+), or an array of those applied in order (0.4.11+) | Mutates the held model in place (no rollback); `reload: true` re-parses the case once, before the first script |

All six are registered once at the end of `apply()` and are **global to the host process**;
every call is gated on the iPSS Agent workspace check, so a non-`iPSS Agent` workspace gets an
explicit failure message rather than a missing tool.

`interpss_case_load` is the explicit first step: its description, the other tools'
descriptions, and every `ipss-case-*` skill (`info`, `aclf`, `summary`, `script`, `ca`) say to call
it before the others when the selected case has not been loaded yet. Nothing enforces the order — each tool
still loads on demand, so skipping the step is safe, just less explicit.

```js
// lib/index.js — apply()
const tools = ctx.get('tools')
if (tools !== undefined) {
  const chatToolDefs = [caseLoadTool(ctx), networkInfoTool(ctx), runAclfTool(ctx), caseSummaryTool(ctx),
    runGvyTool(ctx), runCaTool(ctx)]
  for (const definition of chatToolDefs) {
    ctx.effect(() => tools.register(definition))
  }
  diag('chat tools registered: ' + chatToolDefs.map((definition) => definition.name).join(', '))
}
```

`ctx.get('tools')` is guarded rather than injected (the row only injects `typert`), and both
outcomes are recorded in `$TMPDIR/dsh-interpss-diagnostic.log`.

## Case selection

Every tool takes an optional `case` argument (the others are tool-specific — see each section
below) and otherwise resolves the current case through the shared `resolveToolCase()` helper, in
this order:

1. the `case` argument, when supplied;
2. the case currently selected in the InterPSS tab;
3. the case the embedded bridge already holds.

| `case` form | Example |
| --- | --- |
| Workspace-relative path | `data/ieee/Ieee118Bus/ieee118.ieee` |
| Workspace-relative, as the session shows it | `wspace/data/ieee/Ieee118Bus/ieee118.ieee` (the `wspace/` and `./wspace/` prefixes are stripped before matching — 0.3.18) |
| Absolute path containing `/wspace/data/` | `/…/ipss-agent/wspace/data/ieee/Ieee14Bus/ieee14.ieee` |
| Preset label (case-insensitive) | `IEEE 118-bus`, `IEEE 14-bus`, `Texas 2K-bus` |

Anything else fails with `unrecognized case selector …` before the bridge is touched.

Resolution reports where the case came from as `source`:

| `source` | Meaning |
| --- | --- |
| `argument` | The `case` argument was used |
| `selection` | The case selected in the InterPSS tab |
| `bridge` | The case the JVM already held |
| `none` | Nothing resolved — the failure case |

**How the tab's selection reaches the Host.** The tab calls the `checkResult` RPC on mount and
on every selection change (preset switch, custom path, file picker, remount). The Host records
a valid `data/…` path per session there, and `loadCase` records it again with the explicit
format. No client-side reporting call and no extra endpoint were added for this.

## `interpss_case_load`

| | |
| --- | --- |
| Input | `{ case?: string }` |
| Output | `{ ok, case, source, format, alreadyLoaded, busCount?, branchCount?, error? }` |
| `presentationMeta` | `{ ok, case, source, format, alreadyLoaded }` |
| Card key | `interpss_case_load` (0.3.6+) |

Behaviour: resolves the case like the other tools and then calls
`javaBridge.caseInfo(format, absCase)` — the same "load if absent, else reuse" path they use.
So the tool is a **no-op** reporting `alreadyLoaded: true` when the bridge already holds that
exact case (no re-parse, no JVM round trip beyond the state check), and otherwise parses the case
file and reports the active bus/branch counts with `alreadyLoaded: false`.

It is the explicit "get the case into memory" step: call it before the other tools when the
selected case has not been loaded yet. It deliberately does **not** return the network-info text —
that is `interpss_network_info`'s job — and it does not change the tab's **Load** button, which
always re-parses by design.

**Loading also moves the tab (0.3.19/0.3.22).** A tool that loads — or switches to — a case records it
as the session's current case (`adoptLoadedCase()`), and the Client mirrors the bridge's case into the
tab's **Simu Case** picker through the `interpss/getBridgeCase` RPC (polled while the tab is mounted,
plus on window focus). So after a chat call loads Texas 2K, the picker shows *Texas 2K-bus* (or the
custom-path row for a case with no preset) and the next no-argument tool call resolves to that case
rather than to whatever the tab had selected. The RPC carries the case's bus/branch counts too, so the
tab also prints its `✓ Loaded: N buses, M branches` indicator and refills its network-info panel —
exactly what its own **Load** button does. Since switching views unmounts the tab, its first poll after
a remount re-shows that indicator whenever the picker's case is the loaded one (0.3.23), so the
confirmation survives moving between Chat and the tab.

Failure payloads are the same shape as the other tools, and reuse their messages for the workspace
gate, a missing bridge and an unrecognized selector. The one message specific to this tool is
reached when nothing is selected and nothing is held:

- `no simulation case is selected: pick one in the InterPSS tab, or pass `case` (a data/... path, an absolute path containing /wspace/data/, or a preset label)`

## `interpss_network_info`

| | |
| --- | --- |
| Input | `{ case?: string }` |
| Output | `{ ok, case, source, busCount?, branchCount?, lfConverged, reused, networkInfo, error? }` |
| `presentationMeta` | `{ ok, case, source, lfConverged }` |
| Card key | `interpss_network_info` (0.3.4+) |

Behaviour: the case is loaded into the embedded bridge as part of the call via
`javaBridge.caseInfo(format, absCase)`. A case the bridge already holds is **reused** rather
than re-parsed, so a converged ACLF result is preserved and reported (`reused: true`) instead
of being replaced by base-case values. `busCount` / `branchCount` are parsed from the
network-info text, and are omitted from the result when absent so the value always satisfies
the declared output schema.

Failure payloads use the same shape with `ok: false` and an `error` string, for example:

- `InterPSS is not available in this workspace: the workspace README.md first heading must be "iPSS Agent"`
- `the in-process InterPSS bridge is unavailable; install java-bridge and rebuild the uber JAR (see scripts/setup-java-bridge.sh)`
- `no simulation case is loaded in the InterPSS bridge`

## `interpss_run_aclf`

| | |
| --- | --- |
| Input | `{ case?: string }` |
| Output | `{ ok, case, source, format, converged, busCount?, branchCount?, resultDir, files[], networkInfo, error? }` |
| `presentationMeta` | `{ ok, case, source, resultDir, converged, files[] }` |
| Card key | `interpss_run_aclf` (0.3.2+) |

Behaviour:

- Reuses the model already loaded in the bridge (no re-parse), otherwise loads the case first;
  the solve itself always runs.
- Solver options come from the case-folder `config/aclf_run.json` when present, otherwise
  `config/aclf_run.json` — the same two-tier rule as `ProjectPaths`, shared with the tab's
  `runAclf` RPC through `resolveAclfConfigPath()`.
- Writes `<stem>_DF_bus.csv`, `<stem>_DF_branch.csv`, `<stem>_DF_gen.csv`,
  `<stem>_DF_load.csv` and `<stem>_network_info.txt` under `wspace/<case dir>/result/`.
  `*_DF_contingency.csv` is untouched — that comes from a contingency run.
- A solve that does **not** converge is still a successful call: `ok: true, converged: false`.
  The mismatch and its bus are in the network-info text; do not report the case as solved and
  do not retry the identical call unchanged.
- **The runner settles the solution before writing results.** InterPSS can return from
  `algo.loadflow()` with a converged NR loop whose *last adjustment* — a switched-shunt step, a
  PV→PQ Q-limit conversion, a tap move — was never carried into the solved state; the returned
  voltages then violate that bus's balance. On Texas 2K this left Bus2127 (MIAMI 0, a PV bus
  converted to PQ next to a 200 Mvar switched shunt) 2.26 pu out of balance behind a
  "converged" result. `AclfRunner.settle()` re-solves while `net.maxMismatch(NR)` exceeds
  1e-4 pu (bounded at three passes, stopping as soon as the residual stops improving), so the
  CSVs, the network info and every tool describe the state actually returned. It fires only
  when the violation exists: IEEE 14 and IEEE 118 still solve in one pass, unchanged.
- **One mismatch source.** `_network_info.txt` and `interpss_case_summary` both report
  `net.maxMismatch(NR)` — the same value the NR loop logs per iteration, in pu on the 100 MVA
  base. (Before this, the network info substituted `gen − calNetPQResults()`, which is
  `load − capacitorQ` by construction and reported ~0 for exactly the buses that were out of
  balance, so the tool and the report disagreed.)
- Large cases (PSS/E 2K-bus and up) can take minutes (the settle pass adds at most one more
  solve, and only on a case that needs it).

## `interpss_run_ca`

| | |
| --- | --- |
| Input | `{ case?: string, contingencyFile?: string, monitorFile?: string, overloadThreshold?: number }` — all optional |
| Output | `{ ok, case, source, format, resultDir, contingencyCsv, contingencyFile?, monitoredBranchFile?, threshold?, contingencies?, monitoredBranches?, overloads?, caSummary, error? }` |
| `presentationMeta` | `{ ok, case, source, resultDir, contingencyCsv }` |
| Card key | `interpss_run_ca` (0.4.1+; its **Explore result → Contingency** row since 0.4.2) |

A DC contingency analysis driven entirely from chat — **the Contingency Analysis dialog is not
involved and nothing is prompted for**. It calls the same `javaBridge.runContingency()` the tab's
dialog uses, so the result file is identical; the tool simply resolves the inputs itself:

1. the `contingencyFile` / `monitorFile` argument;
2. the case folder's `config/ca_run.json` (what the dialog would have saved);
3. the case-folder discovery heuristic (first `*contingenc*.json`, first `*monitor*.json`);
4. the Java defaults — N-1 outages on every branch not connected to the reference bus, every branch
   monitored, 90 % overload threshold.

`overloadThreshold` (0.4.6+) follows the same ladder and is the value the dialog's **Over Loading
Threshold(%)** field writes: the argument wins, else the case's `config/ca_run.json`, else 90. It is a
loading percentage (`0 < t <= 1000`); anything else is rejected before the bridge is called. Each
argument overrides **only the keys it names** (0.4.7+), so `interpss_run_ca(overloadThreshold: 80)`
keeps the case's own contingency and monitored-branch selection and just reports from 80 % — the same
way `contingencyFile` alone keeps the case's monitored set. The threshold is no longer a constant, so
`ca_run.json` carries a fifth key, and the dialog's **OK** persists it alongside the other four:

```json
{ "contingencyMode": "custom", "contingencyFile": "…", "monitorMode": "all", "monitoredBranchFile": null, "overloadThreshold": 85 }
```

| Argument form | Resolves to |
| --- | --- |
| `2k_contingencies_115kVAbove.json` | `wspace/<case dir>/2k_contingencies_115kVAbove.json` |
| `data/psse/Texas2K/x.json` | that path under `wspace/` (the `wspace/` and `./wspace/` prefixes are stripped) |
| an absolute path containing `/wspace/data/` | the same file, converted to the `data/…` form |

A non-`.json` file, a `..` segment, a path outside `wspace/` or a file that does not exist is rejected
before the bridge is called.

`render()` prints the threshold it used (the resolved one — argument, `ca_run.json` or 90), the
contingency / monitored-branch / overload counts, the inputs actually used (`all N-1 outages` / `all
branches monitored` when the defaults applied) and the CSV path. `caSummary` carries the runner's raw
`ContAnalysisSummary` text for cross-checking.

Behaviour and caveats:

- The runner solves its **own DC load flow**, so the case only has to be loaded — not solved — and a
  prior `interpss_run_aclf` does not change the result. It is screening, not an AC assessment.
- It **overwrites** `<stem>_DF_contingency.csv`; a NERC report built from the previous file becomes
  stale.
- Large cases take minutes (Texas 2K is ~3200 N-1 outages at 3220 monitored branches).
- The CSV columns are `BranchID, BranchName, BranchCode, IsXfmr, ContingencyName, OutageBranchId,
  OutageBranchName, BasecaseFlowMW, PostFlowMW, LineRatingMW, LoadingPercent` — one row per
  (monitored branch, contingency) pair above the threshold.

The card carries an **Explore result** row with a single **Contingency** button, paging the
contingency CSV through the same `interpss/readCsv` endpoint the tab's Contingency tab uses (100 rows
per page, next page auto-loaded on scroll). The table opens **sorted by `LoadingPercent`, worst first**, and any
column header is clickable to sort by it (a second click flips the direction) — `readCsv` sorts the
whole file before slicing a page, so the order holds across paging. It reuses the ACLF card's panel with one scope and no
**Report** button — generating the NERC TPL-001-5 report stays a separate step, since that report
needs the ACLF CSVs too.

## `interpss_case_summary`

| | |
| --- | --- |
| Input | `{ scope?: 'net' \| 'bus' \| 'gen' \| 'load' \| 'branch', sortRule?: string, numRec?: number }` |
| Output | `{ ok, case, source, scope, converged?, buses?, branches?, generationMw?, loadMw?, maxMismatchP?, maxMismatchQ?, rows?, error? }` — `converged` on every scope; the other totals only with `scope: 'net'` |
| `presentationMeta` | `{ ok, case, scope, rowCount }` |
| Card key | `interpss_case_summary` (0.3.7+) |

A port of `IpssAgentBridge.summarize()`. It reads the **cached model**, so the case only has to be
loaded — not solved — and a base case reports base-case values. `scope` defaults to `net` (the
case-wide totals); the other scopes add `rows` ranked by the InterPSS adapter:

| `scope` | Ranked by | Order |
| --- | --- | --- |
| `net` (default) | — | no rows, just the totals |
| `bus` | voltage magnitude | lowest first, or highest when `sortRule` contains `"High"` |
| `gen` | generation | largest first |
| `load` | load | largest first |
| `branch` | from-side flow **magnitude** | largest first |

Row shape is uniform: `{ id, name, bus?, value, unit, mvar? }`, where `unit` is `pu` (bus),
`MW` (gen/load) or `MVA` (branch). `numRec` defaults to 10 and is capped at 100; rows whose ranked
quantity is missing are dropped rather than reported as 0.

Three deliberate differences from the raw RPC:

1. **The container is sliced, not forwarded.** The Java result container *always* carries every
   section — only the requested one is ranked and limited — so on a large case the bridge payload
   is large (megabytes for a 2K-bus case). The tool parses it, keeps `netResults` plus the
   requested section, and returns a bounded row list. `text` is a JSON string inside the JSON
   envelope, so this means a second parse inside the Host.
2. **An unknown `scope` is rejected.** The RPC's `switch` silently falls back to `net`, which
   truncates every section in *model order* — a "summary" that is not a ranking. The tool fails
   with `unknown scope "…"` instead.
3. **`net` returns no rows.** The RPC's `net` branch truncates each section to `numRec` in model
   order (Bus1…BusN); the tool uses `net` for the totals only.

No `interpss_case_summary` call has a card: the tool **returns** its totals or its `rows` — that is
what the agent builds the chat report from — and renders **nothing** in the conversation. The card
would only repeat the report, so 0.3.11 dropped it for the ranked scopes and 0.3.12 for `net` too
(0.3.9/0.3.10 had already removed its `case · scope · converged` preamble). `case`, `scope` and
`converged` stay in the tool result for the report.

Caveats worth knowing: branch ranking is by flow magnitude, **not** by rating loading, so it will
not reproduce a "highest-loaded branches" list — read the `Loading%` column from the result CSV for
that. `sortRule` is only read by the `bus` scope, and only as a substring test on `"High"`;
`gen`/`load`/`branch` ignore it. With nothing loaded, the tool reports
`no simulation case is loaded in the InterPSS bridge: call interpss_case_load first`.

## `interpss_run_gvy`

| | |
| --- | --- |
| Input | `{ script: string \| string[], case?: string, reload?: boolean }` — `script` is required: a `.gvy` selector, inline Groovy source (0.4.9+), or an array of those (0.4.11+, ≤ 20) |
| Output | `{ ok, case, source, format, script, reload?, elapsedMs?, returnValue?, returnType?, stdout?, line?, buses?, branches?, loadMw?, generationMw?, loadMwBefore?, generationMwBefore?, lfConverged?, scripts?, scriptCount?, applied?, failedScript?, steps?, error? }` — the `scripts`/`scriptCount`/`applied`/`failedScript`/`steps` group belongs to the array form (0.4.11+) |
| `presentationMeta` | `{ ok, case, source, script }` |
| Card key | `interpss_run_gvy` (0.3.17+) |

Applies a Groovy script to the **live** `AclfNetwork` held in the bridge, using
the agent's own adapter `org.interpss.agent.script.gvy.AclfNetDshGvyScriptProcessor` (see
[groovy-script-adapter-architecture.md](groovy-script-adapter-architecture.md)): the network is bound
as `aclfnet` and a DC sensitivity analyser as `senAlgo`, `Complex` and the sensitivity types are
pre-imported, and property assignment maps to JavaBean setters (`bus.loadP = 0.18`,
`branch.status = false`, `load.loadCP = new Complex(p, q)`). The `Dsh` infix (0.4.10+) marks the
agent's processors apart from the older `org.interpss.script.gvy.*` classes that still ship inside
`ipss-runnable`.

**Where the script comes from.** `script` carries the adapter's **two entry points** — a file
selector, or the source itself:

| `script` form | Resolves to |
| --- | --- |
| `ieee14_adjBus14.gvy` | `wspace/<case dir>/scripts/ieee14_adjBus14.gvy` |
| `data/ieee/Ieee14Bus/scripts/ieee14_adjBranch1_2.gvy` | that path, verbatim |
| an absolute path containing `/wspace/data/` | the same file, converted to the `data/…` form |
| `wspace/script/ieee14_adjBus14.gvy` | `wspace/script/ieee14_adjBus14.gvy` — the **workspace fixtures folder**, read by the Host and evaluated as source (0.4.12+) |
| an absolute path containing `/wspace/script/` | the same workspace file |
| `aclfnet.getBus('Bus14').getContributeLoad('Bus14-L1').loadCP = new Complex(0.50, 0.30)` | evaluated as inline Groovy — no file written (0.4.9+) |

The rule between them is the value's shape: a single bare word is a **file selector**, so
`ieee14_adjBus14.gvy` and a `data/…/scripts/x.gvy` path stay file names; anything carrying
**whitespace or statement punctuation** (`=`, `(`, `;`, braces, quotes, commas…) is **source** — which
covers both one-liners and multi-line scripts. A single token that names something else (`scripts/x.txt`)
stays a selector, so it keeps the actionable `unrecognized script selector` error rather than being
evaluated as Groovy.

**Several scripts in one call.** Pass an **array** (0.4.11+) and the tool applies every entry, in
order, to the same held model:

```
interpss_run_gvy({ script: ['mask_branch.gvy', "aclfnet.getBus('Bus14').loadP = 0.5", 'export.gvy'] })
```

- Every entry is classified and resolved **before the first one runs**, so a typo in the last selector
  fails the call without touching the model (`script 2 of 3 …`).
- `reload: true` re-parses the case **once**, before the first script; later scripts must see the
  earlier edits (that is the point of a sequence).
- The run **stops at the first failure** — earlier edits stay applied, like any failed script — and the
  result reports `applied` (how many ran), `failedScript`, `error` and `line`. Nothing is rolled back.
- The digest spans the whole run (`loadMwBefore` from the first script, `loadMw` from the last) and
  `steps` carries one entry per script: its `script` label, `elapsedMs`, `loadMw`/`loadMwBefore`
  delta, `returnValue`/`returnType` and any `stdout`.
- The card lists the steps, one per line, with each step's own delta and return value.
- Up to 20 scripts per call; a `.gvy` file and inline source mix freely in the array.

There are two script folders, and they differ in who opens the file. A **case script**
(`<case folder>/scripts/x.gvy`, or a bare `x.gvy`) is handed to the JVM as a path — the tool and the
Java side both refuse anything outside that folder, so a case script can never be shared silently. A
**workspace script** (`wspace/script/x.gvy`, 0.4.12+) is read by the **Host** and sent as source, which
is what makes one fixtures folder usable from every case; the JVM still opens nothing outside the case
folder, and the card names the workspace path (`script/x.gvy`) rather than `inline Groovy (N lines)`.

A file selector that leaves those folders, is not a `.gvy` file or contains a `..`
segment is rejected before the bridge is called, and a missing file fails with the names of the `.gvy`
files that *are* there; the Java side re-checks the same rule (`.gvy`, regular file, under
`<case folder>/scripts/`, ≤ 256 KB) so a direct bridge caller cannot bypass it. Inline source is
evaluated as given (`inline Groovy (N lines)` is what the result and the card call it) and is bounded
by the same 256 KB limit.

Both paths land in the same JVM call and the same digest: `IpssAgentBridge.runGvy` (a file, through
`GvyScriptRunner.runOnNet`) and `IpssAgentBridge.runGvySource` (source, through
`GvyScriptRunner.runSourceOnNet`) share the model load, the scalar-only result rendering and the
`{ ok, error, line }` failure shape.

**It queries as well as edits.** `senAlgo` (0.4.10+) is a `SenAnalysisAlgorithm` over the same live
network — `calBusSensitivity(SenAnalysisType.QVOLTAGE, fromBus, toBus)` for dV/dQ,
`calGenShiftFactor(injBusId, branch)` for a GSF, `addInjectBus` / `addWithdrawBus` +
`genTransferDistFactor(branch)` for weighted transfers — with its types pre-imported and its DC base
case built on demand (no ACLF *required*):

```
interpss_run_gvy({ script: "senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, 'Bus14', 'Bus14')" })
  Returned: 0.4436834940076393
```

The answer describes **the state the bridge holds**, so solve first when it must describe the solved
operating point: on `data/ieee/Ieee14Bus_LargeLoadQ/ieee14.ieee`, Bus14's self dV/dQ is `0.2558` pu/pu on
the freshly parsed case and `0.4437` pu/pu after `interpss_run_aclf` (V(Bus14) = 0.8714).

That case is the worked load-Q workflow — size from dV/dQ, solve, trim the reactive load with a fresh
parse, solve again: `ieee14_dvdq_Bus14.gvy` → `interpss_run_aclf` →
`ieee14_adjBus14Q_0p89to0p90.gvy` (`reload: true`) → `interpss_run_aclf`. It is written up in
[load-q-adjustment.md](load-q-adjustment.md) and the
[Loadflow Adjustment User Guide](user_guide/loadflow-adjustment-user-guide.md). The array form is for
edits that chain on the held model — `['mask_branch.gvy', "aclfnet.getBus('Bus14').loadP = 0.5"]` — not
for steps that each need their own solve, which keep an `interpss_run_aclf` between them as this
workflow does.

**What it returns.** The digest is measured around the evaluation, so a mutation-only script still
shows its effect: `loadMw` / `generationMw` after the run, `loadMwBefore` / `generationMwBefore`
before it, plus `buses`, `branches` and `lfConverged`. The script's last expression is reported as
`returnValue` **only when it is a scalar** (`String`, `Number`, `Boolean`, `Character`, `Complex`);
a model object is never serialized — its simple class name comes back as `returnType` instead. Extra
`println` output from the script is captured and returned as `stdout` (truncated at 8000 characters).

**Mutating semantics** (the whole point, and the main caveat):

- Edits happen **in place** on the held model and are **never rolled back**; a script that fails
  halfway keeps what it already changed, and the failure carries `line` — the line **in the script you
  passed**, since the adapter subtracts the `GVY_IMPORTS` block it prepends in front of it — so the
  caller can fix it.
- Running the same script twice applies it twice, unless it assigns absolute values. `reload: true`
  re-parses the case from disk before evaluating, which is the only reset.
- This tool **only edits**: solving stays with `interpss_run_aclf`, which the caller runs afterwards
  (the digest says `not solved` until then).
- `.gvy` files are executable code with full access to the bound model: only run scripts you trust.

Worked example — the shipped IEEE 14 fixtures:

```
interpss_run_gvy({ script: 'ieee14_adjBus14.gvy', case: 'IEEE 14-bus' })
  Model: 14 buses · 20 branches · load 259.00 → 262.10 MW (+3.10) · gen 272.35 → 272.35 MW · not solved

interpss_run_gvy({ script: "aclfnet.getBus('Bus14').getContributeLoad('Bus14-L1').loadCP = new Complex(0.50, 0.30)",
                   case: 'IEEE 14-bus', reload: true })
  Model: 14 buses · 20 branches · load 259.00 → 294.10 MW (+35.10) · gen 272.35 → 272.35 MW · not solved

interpss_run_aclf()          # solves the edited case and rewrites the result CSVs
```

## Tool cards

Six cards are registered in the session-scoped `tool.call.toolview` slot, keyed by the wire
tool name:

```js
slots.inject('tool.call.toolview', () => slots.register(
  { name: 'tool.call.toolview', key: 'interpss_run_aclf' },
  (props) => React.createElement(AclfResultCard, { … }),
))
slots.inject('tool.call.toolview', () => slots.register(
  { name: 'tool.call.toolview', key: 'interpss_network_info' },
  (props) => React.createElement(NetworkInfoCard, { block: props && props.block }),
))
slots.inject('tool.call.toolview', () => slots.register(
  { name: 'tool.call.toolview', key: 'interpss_case_load' },
  (props) => React.createElement(CaseLoadCard, { block: props && props.block }),
))
slots.inject('tool.call.toolview', () => slots.register(
  { name: 'tool.call.toolview', key: 'interpss_case_summary' },
  (props) => React.createElement(CaseSummaryCard, { block: props && props.block }),
))
slots.inject('tool.call.toolview', () => slots.register(
  { name: 'tool.call.toolview', key: 'interpss_run_gvy' },
  (props) => React.createElement(RunGvyCard, { block: props && props.block }),
))
slots.inject('tool.call.toolview', () => slots.register(
  { name: 'tool.call.toolview', key: 'interpss_run_ca' },
  (props) => React.createElement(RunCaCard, { block: props && props.block }),
))
```

The short-result tools share one implementation: `toolTextCard(label)` returns a hook-free
component that renders the settled text directly (or a title line while running), and
`NetworkInfoCard` / `CaseLoadCard` / `CaseSummaryCard` / `RunGvyCard` / `RunCaCard` are that
factory bound to their labels. Only the ACLF card needs hooks, because it fetches rows.

`CaseSummaryRow` wraps `CaseSummaryCard` with one gate: **every settled, successful** summary block
returns `null`, so nothing is shown for any scope. Because a keyed `toolview` replaces the whole tool
row, that removes the row and the card together — the summary is invisible by design and the chat
report is the only place its numbers appear. A failed call always renders its error, and an unsettled
or metadata-less (replayed) block falls back to the text card instead of disappearing.

Two rules shape them:

1. **A registered key replaces the generic row.** The shipped `ToolRow` keeps a tool's output
   behind an expand toggle (`expanded` defaults to `false`), which is why
   `interpss_network_info` gained its own card in 0.3.4 and why `interpss_case_load` and
   `interpss_case_summary` have one — their summaries would otherwise be invisible in the
   conversation. Because the key is a
   replacement, a card that returned `null` would leave an **empty cell**; every card therefore
   renders in every state (running, error, or a replayed log with no usable metadata).
2. **Hooks stay stable across the running → settled transition.** The short cards are hook-free
   entirely; the ACLF card is a hook-free gate (`AclfResultCard`) that narrows the immutable
   block into plain props and hands them to a hook-using panel, so the hook order never depends
   on that transition.

`toolResultText()` joins **every** text block of a settled result. Requiring exactly one block
silently dropped the summary whenever the content layout differed.

### Result explorer (ACLF card, 0.3.2+)

The settled card shows an **Explore results** row with **Bus / Branch / Gen / Load**. Each
scope fetches 100 rows through the existing `interpss/readCsv` RPC — the same endpoint the
tab's explorer uses — and appends the next page automatically when the table is scrolled to
the bottom (the same 40 px threshold as the tab's `handleCsvScroll`; there is no *Load more*
control as of 0.3.5). A ref gates the in-flight fetch so a burst of scroll events cannot
request the same page twice.

### Report button (ACLF card, 0.3.3+)

Next to the scopes, **Report** generates the AC Loadflow Markdown report from the run's CSVs
and opens `wspace/<case dir>/result/AC_Loadflow_Report.md` in the harness file surface (via
the card's `openFile` prop). It passes `reportType: 'aclf'` explicitly, because the Host's
`runReport` otherwise auto-selects NERC when a `*_DF_contingency.csv` exists — the tab's own
Report button keeps that auto-selection.

## Relationship to the tab and the RPCs

| Capability | InterPSS tab | Chat tool | Underlying RPC / service |
| --- | --- | --- | --- |
| Load the selected case | Load button (always re-parses) | `interpss_case_load` (reuses when held) | `interpss/loadCase`, `javaBridge.caseInfo` |
| Show the case the bridge holds | Simu Case picker (mirrors it, 0.3.19) | — | `interpss/getBridgeCase` |
| Case totals / top-N ranking | — (the tab has no equivalent) | `interpss_case_summary` | `interpss/summarizeResult` |
| Network info | Network info panel | `interpss_network_info` | `interpss/getNetworkInfo`, `javaBridge.caseInfo` |
| Run ACLF | ACLF button | `interpss_run_aclf` | `interpss/runAclf` |
| Run DC contingency analysis | CA dialog (or bypassed) | `interpss_run_ca` (dialog-free) | `interpss/runCa`, `javaBridge.runContingency` |
| Apply a Groovy scenario edit / query | — (the tab has no script surface) | `interpss_run_gvy` (a file, inline source, or an array) | `interpss/runGvy`, `javaBridge.runGvy` / `runGvySource` (0.4.9+) |
| Browse results | Bus/Branch/Gen/Load tabs | card's Explore row | `interpss/readCsv` |
| Generate report | Report button | card's Report button | `interpss/runReport` |

The tools add **no** `/api` endpoint of their own. `METHODS` had gained only the CA-dialog methods
(`listCaFiles`, `getCaOptions`, `saveCaOptions`); 0.3.19 adds `getBridgeCase`, which the tab's picker
polls and no tool calls — 18 in total.
The one Host RPC signature that grew is `runReport`, which now accepts an optional
`reportType` (`aclf` | `nerc`) that takes precedence over the contingency-based auto rule.

The bridge's `lastLoadedAbs` mirrors `IpssAgentBridge.loadedInput` and is updated by
`loadCase`, `runAclf`, `runGvy` / `runGvySource` and `runContingency` — every JVM load goes through this module's
`javaBridge` provider, so the mirror cannot drift in practice. It backs the `bridge` source in
case resolution, `reused` in `caseInfo`, and (0.3.19) the `case` that `getBridgeCase` hands the
tab's picker.

## Related skills

| Skill | Use |
| --- | --- |
| `ipss-case-load` | Load a case into the bridge and report its counts (wraps `interpss_case_load`) |
| `ipss-case-info` | Report the current case's network info (wraps `interpss_network_info`) |
| `ipss-case-aclf` | Run ACLF for the current case (wraps `interpss_run_aclf`) |
| `ipss-case-aclf-adjust` | Adjust bus load Q to bring a bus voltage into a target band — dV/dQ sizing, scripted edit, ACLF confirmation (guides `interpss_run_gvy` + `interpss_run_aclf`) |
| `ipss-case-summary` | Summarize the current case — totals or a top-N ranking (wraps `interpss_case_summary`) |
| `ipss-case-script` | Apply a scenario edit to the current case — `.gvy` scripts and/or inline Groovy, one call or a sequence (wraps `interpss_run_gvy`) |
| `ipss-case-ca` | DC contingency analysis for the current case, dialog-free (wraps `interpss_run_ca`) |
| `ipss-case-diagram` | Draw the current case's one-line diagram — `.drawio` plus a PNG preview under the case's `diagram/` folder, in the template's style, from its ACLF result tables (`wspace/script/gen_oneline_diagram.py`) |
| `ipss-sim` | Full simulation and reporting workflow through the Java CLI (`IpssCmd`) |
| `nerc-report-html`, `nerc-report-slides` | Follow-on artifacts from a NERC report |

Canonical skill sources live in `.agents/skills/<name>/SKILL.md`. DSH discovers them as `/<name>`
when the session workspace is this repository, and `~/.dsh/skills/<name>/SKILL.md` (installed by
`SYNC_DSH_SKILLS=1 scripts/sync_ipss_skills.sh`) makes them available in every session; the same
script installs the Codex prompts under `~/.codex/prompts/`.

## Adding another tool

1. Define a factory in `interpss-persistent/lib/index.js` returning the definition
   (`name`, `description`, raw JSON Schema `parameters`, `output.schema`, `output.render`,
   optional `output.presentationMeta`, `execute`). Object nodes in `output.schema` must
   declare `additionalProperties` explicitly.
2. Reuse the shared helpers: `resolveToolCase()` for selection, `resolveWorkspaceRoot()`,
   `isIpssWorkspace()`, `casePartsOf()`, `resolveAclfConfigPath()`.
3. Add the factory to `chatToolDefs` in `apply()`.
4. Optionally register a card in `lib/client.js` under `tool.call.toolview` keyed by the new
   wire name — the key domain is open, so this is additive for your own tool.
5. Bump the package version, repack and reinstall — see
   [persistent-plugin-rebuild.md](persistent-plugin-rebuild.md).

Prefer returning a small `presentationMeta` (scalars and file names only, never rows or live
objects) so a card can render without re-deriving paths from the result text.

## Version history

| Version | Change |
| --- | --- |
| 0.3.0 | `interpss_network_info`; per-session tab-selection recording; `javaBridge.caseInfo` |
| 0.3.1 | `interpss_run_aclf`; shared `resolveToolCase` / `casePartsOf` / `resolveAclfConfigPath` |
| 0.3.2 | ACLF card with the Bus / Branch / Gen / Load explorer (`presentationMeta` + `tool.call.toolview`) |
| 0.3.3 | ACLF card **Report** button; explicit `reportType` on `runReport` |
| 0.3.4 | Network-info card (renders the summary instead of the generic expand toggle); multi-block-safe result text |
| 0.3.5 | Explorer pages auto-load on scroll, replacing the *Load more* control |
| 0.3.6 | `interpss_case_load` (explicit load step) + its card; shared `toolTextCard` for the two short-result cards |
| 0.3.7 | `interpss_case_summary` (port of `summarize()`) + its card: net totals, or a sliced top-N ranking |
| 0.3.8 | Summary totals belong to `scope: "net"`; ranked scopes carry only their rows (+`converged`) instead of repeating the totals on every card |
| 0.3.9 | A ranked summary card renders its table alone — the `case · scope · converged` header line and the blank line after it are gone |
| 0.3.10 | No summary card carries the `case · scope · converged` preamble any more: the `net` card is its two totals lines (the case identity stays in the tool result and the chat report) |
| 0.3.11 | A ranked summary call shows **no card**: its rows still reach the agent, but the card would only repeat the chat report's table, so the gate in `CaseSummaryRow` hides the row entirely |
| 0.3.12 | The `net` totals card goes the same way: no `interpss_case_summary` call renders anything (the chat report is the summary) |
| 0.3.17 | `interpss_run_gvy`: apply a Groovy `.gvy` script from the case folder's `scripts/` directory to the held case, with a before/after digest and captured script stdout (Java: `GvyScriptRunner` + `IpssAgentBridge.runGvy`, Groovy 4.0.x added to the uber JAR) |
| 0.3.18 | Every `case` / `script` selector also accepts the `wspace/data/…` (and `./wspace/data/…`) spelling a session shows, not just `data/…` |
| 0.3.19 | The tab's Simu Case picker mirrors the case the bridge holds (`interpss/getBridgeCase`, polled + on focus), and a tool that loads a case adopts it as the session's current case, so picker, selection and model agree |
| 0.3.20 | The bridge JVM starts with `-Xmx8g` instead of `-Xmx4g`, so the 78k-bus Eastern Interconnect case fits |
| 0.3.21 | The load card prints the tab's confirmation line, `✓ Loaded: N buses, M branches` (`✓ Already loaded: …` for a no-op) |
| 0.3.22 | `getBridgeCase` also carries the held case's bus/branch counts, so the tab prints its `✓ Loaded: N buses, M branches` indicator and refills the network-info panel for a load driven from chat |
| 0.3.23 | Switching between the Chat view and the InterPSS tab restores that indicator: the view's first poll re-shows `✓ Loaded: …` whenever the picker already points at the loaded case, instead of blanking on remount |
| 0.4.2 | The CA card gains an **Explore result → Contingency** row (the ACLF explorer panel parameterized: one scope, no Report button, its own labels) |
| 0.4.3 | Explorer tables sort: `readCsv` takes `sortColumn`/`sortDesc` and sorts the whole file before paging, headers are clickable with a ▲/▼ marker, and the CA table opens worst-`LoadingPercent`-first |
| 0.4.4 | The tab's result tables sort too: `renderCsvTable`/`renderBusTable` gain clickable headers (▲/▼) and the tab's **Contingency** table opens worst-`LoadingPercent`-first, paging and all |
| 0.4.5 | Version-only repack of the configuration relocation: `aclf_run.json` and `ca_run.json` move to `<case folder>/config/` (the project default stays `config/aclf_run.json`), and every tool/RPC/dialog path follows — `ProjectPaths`, `getAclfOptions`/`getCaOptions`/`saveCaOptions` and the tools' descriptions |
| 0.4.6 | A configurable **over loading threshold** replaces the fixed 90 % threshold: the CA dialog renders a numeric field (seeded from `getCaOptions`, validated before OK), `interpss_run_ca` accepts `overloadThreshold`, `config/ca_run.json` gains the key, and the value reaches the runner through `runContingency`/`resolveInputs`/`setOverloadThreshold` instead of a constant |
| 0.4.7 | Two CA-round-trip fixes: `saveCaOptions` persists `overloadThreshold` with the other four keys (0.4.6 dropped it, so a dialog run at 80 % reopened at 90 % and a later CLI/tool run used 90), and the tool merges its arguments **per key** over the resolved case config instead of replacing it — `interpss_run_ca(overloadThreshold: 80)` no longer discards the case's contingency/monitored-branch selection |
| 0.4.8 | The dialog field is labelled **Over Loading Threshold(%)** (it read *Violation Check Loading (%)* in 0.4.6/0.4.7), and its validation message follows: `over loading threshold must be a percentage between 0 and 1000` |
| 0.4.9 | `interpss_run_gvy`: `script` accepts the Groovy **source itself** as well as a `.gvy` selector (the adapter's inline entry point) — `GvyScriptRunner.runSourceOnNet`, `IpssAgentBridge.runGvySource`, and one `gvyThrough` shared with the file path; the rule is shape-based (a single bare word is a file name, whitespace or statement punctuation means source) |
| 0.4.10 | The Groovy adapter is the agent's own `org.interpss.agent.script.gvy` pair — `BaseDshGvyScriptProcessor` / `AclfNetDshGvyScriptProcessor` (the `Dsh` infix separates them from the older `org.interpss.script.gvy.*` classes still inside `ipss-runnable`) — and it also binds `senAlgo`, a `SenAnalysisAlgorithm` on the same live network, with `Complex`, `SenAnalysisType`, `ContingencyBranchOutageType` and `DclfAlgoObjectFactory` pre-imported, so a script can query dV/dQ, GSF and transfer factors without leaving Groovy; a failure now reports the line in the caller's own script (the prepended `GVY_IMPORTS` block is subtracted) |
| 0.4.11 | `interpss_run_gvy`: `script` also takes an **array**, applying several scripts (files and/or inline source, up to 20) in order on the held model — all entries resolve before the first runs, `reload` still re-parses once, the run stops at the first failure, and `steps`/`applied`/`failedScript` report what each script did; the single-script result and card are unchanged |
| 0.4.12 | `interpss_run_gvy` also accepts the workspace fixtures folder — `wspace/script/x.gvy` or `script/x.gvy` — read by the Host and evaluated as source (so the JVM still opens only case-folder files), and labels the step with that path; the batch card's per-step elapsed time shows its `ms` unit |
| 0.4.13 | Config writes from the ACLF / CA dialogs survive an app-hosted profile: `writeConfigText` keeps the fenced DSH `fs` service when it allows the write and, on `FS_SANDBOX_DENIED` for a path inside the resolved workspace, persists through the plugin's own `node:fs` |
| 0.4.14 | That fallback writes through the caller's absolute path string (the opaque `fs.resolve()` handle is not a `node:fs` path), so both dialogs save in the app-hosted profile |
| 0.5.0 | Version-only minor release rolling up 0.4.1–0.4.14: the dialog-free CA tool, the configurable **Over Loading Threshold(%)** with its `config/ca_run.json` round trip, the agent `*Dsh*` Groovy adapter with the `senAlgo` binding, and inline / array / workspace-`script/` Groovy runs — no behaviour change beyond 0.4.14 |
| 0.4.1 | `interpss_run_ca`: DC contingency analysis from chat with the CA dialog bypassed (explicit inputs → `ca_run.json` → case-folder discovery → N-1 defaults), plus its card and the `ipss-case-ca` skill |
| 0.4.0 | Version-only release: the first 0.4.x, carrying 0.3.17–0.3.23 unchanged (the `interpss_run_gvy` tool and its skill, the `ipss-case-load` skill, `wspace/…` selector spellings, the Simu Case picker + `✓ Loaded:` sync, `-Xmx8g`, and the load card's confirmation line) |
| 0.5.1 | The connection modal renders three full-precision columns to four decimals — `PFrom2To` and `QFrom2To` on the Branch tab (source columns 19/20) and `QGen` on the Gen tab (column 12): `renderConnTable` takes a per-source-column `decimals` map and routes those cells through the existing `formatValue`, so an already-short column stays exactly as the Host sent it |
| 0.6.0 / 0.6.1 | The tab's **Diagram** button: it lists the workspace's `.drawio` files over `listDrawioFiles` / `readDrawio` and renders the chosen one as inline SVG with a **Rendered / Source** toggle — no frames (the preview CSP forbids them) and no MCP call. `diagramXmlFrom` accepts plain XML and draw.io's `base64(raw-deflate(uri-encoded))`; `parseDrawioScene` resolves geometry down the parent chain and skips `group` containers. 0.6.0 shipped a render-time ordering defect (the focus effect above its own state) that blanked the whole tab — silent, since the failure is entirely client-side — and 0.6.1 moved the effect below the state it reads |
| 0.6.2 | Diagram **pan / zoom / fit**: the wheel zooms about the cursor (0.1x–12x), dragging pans, **Fit** returns to the scene viewBox, and the header shows the live percentage. The wheel listener is native and non-passive so `preventDefault` holds, and the cursor anchor is computed through the letterbox `xMidYMid meet` actually draws. The guard suite grows to 55 checks: §5 exercises the zoom/pan math, §7 asserts statically that no `useEffect` reads a binding declared below it, and §8 renders the modal *open* — nothing did before, so a reference error in the toolbar could ship |
| 0.6.3 | The dynamic and persistent plugins are put back **in sync**, and a guard keeps them there: the dynamic body had never received the sortable CSV headers (`csvHeaderCell` + the sort flow) or the CA **Over Loading Threshold(%)** field, and dynamic `client.js` lacked the 0.5.1 connection-table `decimals`. Both halves now carry both features — `applyCsvSort` byte-identical in both hosts, `readCsv` sorting the whole file before slicing a page, `overloadThreshold` validated and round-tripped through `config/ca_run.json`. `nextCsvSort` moved out of the persistent-only tool-card region into the shared body (hoisting had hidden that dependency), and the guard's §9 fails on any drift beyond the documented transport/timer swap. Chat tools stay persistent-only: the dynamic Host is an injected body with no imports, so it cannot carry `node:fs` helpers |
| 0.6.4 | Two Diagram-preview rendering defects. **Paint order**: the preview drew every edge and only then every vertex, so this diagram's `bg` cell — an opaque 900×760 white rectangle declared *before* the branches — covered all 27 of them and the preview showed a one-line diagram with no lines. `parseDrawioScene` now records each cell's document position and `DrawioDiagram` emits groups sorted by it, the way draw.io paints. The no-`strokeColor` fallback also moved from slate `#64748b` to mxGraph's default `#000000` (2 of the 27 edges name no stroke and were the only two in a different color). **Latent crash**: `from`/`to` were `const` yet reassigned for an edge that names no source/target cell, so any diagram with a free-floating edge threw `Assignment to constant variable` instead of rendering. Guard grows to 73 checks, asserting the page fill precedes every branch, the emitted order is non-decreasing document order, the stroke fallback, and the free-floating-edge path. The workspace diagram itself was corrected in the same pass: the transformer rings are now unfilled so both interlocking circles draw complete (the second ellipse's opaque white fill erased the first one's inner arc, leaving a broken open arc), and the 2 stray `xf10b → bg` edges that drew long diagonals across the drawing plus a spurious arrowhead are deleted — 25 edges, no arrowheads. Diagram-file changes are read from the workspace at preview time, so they need no plugin reinstall |
| 0.6.5 | The Diagram preview follows the **app theme**. A draw.io model carries its own palette and these diagrams are ink on paper, so the preview dropped a glaring white slab with black lines into the dark theme. `drawioThemeColor` now re-expresses the grayscale palette at paint time as theme tokens — paper → `--dsw-alias-bg-layer-1`, ink → `--dsw-alias-label-primary`, mid greys → `--dsw-alias-label-secondary` — and the pane's own background uses the paper token, so the letterbox padding matches. Tokens rather than a computed colour, so no theme detection, no `theme` service dependency, and an instant re-colour on a switch; only near-grayscale values are re-mapped, so a deliberately coloured element keeps its identity in either theme. The lightness extremes are tested before saturation because HSL saturation is ill-conditioned near black and white (`#111827`, draw.io's default text colour, computes as 39% "saturated" while reading as ink). Applied in `DrawioDiagram` rather than the parser, so the scene keeps the authored colours. Guard grows to 86 checks |
| 0.6.6 | Diagrams become **per case**. `listDrawioFiles` now takes the selected case and lists the `.drawio` files directly inside `<case folder>/diagram/` (workspace-relative, name-sorted), replacing the workspace-wide `scanDrawio` walk — that scanner and its skip-list/depth/count constants are deleted, and the guard asserts neither host still carries them. The tab's **Diagram** button is enabled only when that folder holds at least one `.drawio`: one answer from one fetch drives both the button's `disabled` state and the picker list, so the two cannot disagree, and a stale answer cannot land on a newer case selection. A case with **exactly one** diagram opens it directly and skips the picker (`drawioDirectPath`, a pure module-level helper); several open the picker, which re-reads the folder on open. An absent case or folder is an empty list rather than an error, since "this case has no diagram yet" is a state the tab renders. Guard grows to 96 checks |
| 0.6.7 | **Tooltips on the diagram's bus and branch elements**, matching the Bus connection diagram: hovering a bus bar (or its `Bus-N` label) shows `busTooltip(record)`, and hovering a branch line — either half of a transformer's two-edge chain, or the transformer symbol — shows `branchTooltip(row)`. Both builders are the connection diagram's own, so the wording cannot drift. The parser now keeps each edge's `id`/`source`/`target` and each vertex's `parent`, and `drawioBranchPairs` resolves every element to a `busa|busb` key once per scene (a transformer's two chained edges are paired through their group cell; the symbol's nodes take the same key). Because a branch is a 1.5px line, each interactive element also emits an invisible hit shape — a wide transparent twin polyline, or a rect padded 4 units — inside the SVG, so nothing is recomputed on zoom or pan. The branch table is indexed once per opened diagram from `<case>/result/<stem>_DF_branch.csv` (paged `readCsv`, an array per pair so parallel circuits all match) along with the canonical `BusN` spelling the Host matches on; bus records are fetched lazily per hovered bus through the existing `busConnections` and cached, which also warms the neighbours. No result table means the tooltip names the element and says `no result data — run ACLF` with no call at all; failures degrade silently rather than erroring the preview. No Host change, `METHODS` unchanged. Guard grows to 124 checks |
| 0.6.8 | **A Diagram tab.** The one-line diagram becomes its own conversation view — Chat · InterPSS · **Diagram** · Trajectory, registered `{ id: 'diagram', order: 2 }` beside the InterPSS tab — instead of a modal only reachable from that tab's action row. It draws the **selected case's** `diagram/*.drawio` full-size, so the InterPSS tab keeps owning "the current case": `onCaseChanged` publishes its selection to a module-level `selectedCaseInput`, the tab seeds from it on mount (a conversation view is mounted one at a time, so there is never a second mounted view to miss a change), and a one-shot `getBridgeCase` on mount adopts a case a chat tool loaded — no timer, and no second divergence between the dynamic and persistent bodies. `drawioTabChoice(files, remembered)` reopens the diagram the user last chose while it is still in the folder (the module-level `diagramChoice` survives the unmount a tab switch causes), else the first, and `null` for an empty folder, which the tab renders as "no diagram yet". Everything else is reused as-is — `diagramXmlFrom`, `parseDrawioScene`, `DrawioDiagram`, the pan/zoom math and both tooltip builders — with no new Host endpoint: `listDrawioFiles`, `readDrawio`, `checkResult` (the result dir the tooltips page `<stem>_DF_branch.csv` from) and `busConnections`. Guard grows to 148 checks: §12 renders the view idle, with no case, with no diagram, with a failed listing, with an open scene, with a tooltip on screen and in its Source view, and asserts the new effects are the ones §7 parses |
| 0.6.9 | The InterPSS tab's **Diagram** button is **removed**, with the modal it opened and the machinery behind it, so the preview has exactly one surface and the action row reads **ACLF · ⚙ · CA · Report**. `refreshCaseDiagrams`, the `drawio*` state (`drawioOpen` / `drawioFiles` / `drawioFilesError` / `drawioPath` / `drawioXml` / `drawioScene` / `drawioLoading` / `drawioError` / `drawioView` / `drawioRect` / `drawioDragging`), the picker and preview bodies, the four effects they drove (focus, branch-index, tip-drop, wheel) and the pure `drawioDirectPath` helper are deleted rather than left unreachable — a second, unmounted copy of the preview would drift from the tab's, and `readDrawio` now has exactly one caller. The renderer helpers and the tooltip builders stay, because the tab uses the same ones; `diagramSeq` and `diagramChoice` stay too, now owned by the tab. The workspace style reference also lost the last documented stray edge (`id="8"`, `xf10b -> bg`), so the reference and the 14-bus case diagram parse to the same 25 edges. Guard: §8 (which rendered the modal open) is retired — the section numbers are left unchanged, since the docs reference them by number — and §10 asserts the action row carries ACLF / CA / Report with no Diagram button, plus the absence of `drawioFiles` / `drawioOpen` / `drawioDirectPath`. 138 checks |
| 0.6.10 | The **Diagram tab's own heading and subtitle are removed** — the `<h2>Diagram</h2>` block and its `The one-line diagram of the case selected in the InterPSS tab.` line. The tab bar already names the view and the first row (`Simu Case <path>`) says what is drawn, so a title block only pushed the drawing down. The tab now renders `caseRow`, `toolbar`, `body`, `tipEl` and nothing above them; the root keeps its `padding: 20px / gap: 10px` layout. Guard §12 asserts the absence (no `h2`, no subtitle string) so the block cannot creep back, and its idle-render check now keys off the **Simu Case** row. 139 checks |
| 0.6.11 | The Diagram toolbar's **`Scroll to zoom · drag to pan` hint is removed**, so the row ends at **Fit** (`Rendered · Source · − · 100% · + · Fit`, with the diagram picker first when the case has several files). The gestures are discoverable without it, and the toolbar stays a row of controls rather than controls plus prose. Guard §12 asserts the string is absent from both the rendered tree and the body. 140 checks |
| 0.6.12 | **Edit the diagram in the local draw.io app.** A draw.io-marked button at the end of the Diagram tab's toolbar hands the open file to the desktop editor — the round trip the one-line diagram workflow already did from a shell (`open -a draw.io <file>`) is now one click from the picture. The browser cannot start a process, so this is a new Host endpoint, `openDrawio` (the 21st `METHODS` entry): the same workspace-relative path and validation as `readDrawio`, resolved to a host path with `fs.processPath`, then launched. The launch goes through the **`subprocess` service**, not `node:child_process`, because the dynamic half is an injected body with no imports; the shared launcher block is byte-identical in both hosts and tries `open -a draw.io <file>` → `open <file>` → `xdg-open <file>` (`cmd /c start "" <file>` on Windows), each rung resolving its executable *before* spawning so a missing command is a message rather than a spawn failure, and reporting every failure with that launcher's own stderr. `open` exits 0 once the OS holds the file, so the answer means "launched", not "saved". The button disables itself while the call is in flight and prints its outcome beside the toolbar (`Launched draw.io (open -a draw.io)`, or the Host's reason); the mark is drawn inline because the page CSP cannot be assumed and the tab works offline. Guard grows to 154 checks: §13 slices the launcher out of the host file and drives the whole ladder against a fake `subprocess` provider — argv, fall-through, no-spawn-when-unavailable, the stderr report and the Windows rung — and §12 clicks the button in a rendered tree to prove it reaches `openDrawio` with the diagram on screen. **This release changes the Host half, so it needs an app restart** (every 0.6.8–0.6.11 change was client-only) |
| 0.6.13 | The draw.io button **moves out of the toolbar into the tab's lower-right corner**: its own row below the drawing (`display: flex; justifyContent: flex-end`), with the launch outcome printing to its left. The toolbar is the view/zoom control row again — `Rendered · Source · − · 100% · + · Fit` — and the one control that leaves the app no longer sits among them. Client-only. Guard §12 stops looking for the button by presence alone: it walks the button's **ancestor chain** to require that right-aligned row, and asserts the toolbar row still ends at **Fit** and contains no draw.io button, so the placement cannot drift back. 156 checks |
| 0.6.14 | **The draw.io button is pinned where it can be seen.** 0.6.13 put it in the tab's lower-right corner as a row appended after the drawing, and with a 70vh canvas plus the tab's chrome that row landed **below the fold** — the button looked like it had disappeared. The row is now `position: sticky; bottom: 8px`, so it stays pinned to the bottom of the tab's scrollport (at the right edge) until its own place scrolls into view, and the canvas is a little shorter (`62vh`, minimum `300px`) so it is normally on screen before any scrolling. Because the pinned strip spans the canvas width, it is `pointerEvents: none` with `auto` on the button and the message, so a drag or a wheel over the strip still reaches the drawing, and the button carries a shadow so it reads as floating above it. Client-only. Guard §12 now asserts the sticky placement and that pointer-events split, not just the flex-end row. 157 checks |
| 0.6.15 | The draw.io button **moves to the upper-right corner**: the last child of the header row that names the case (`justifyContent: space-between` — `Simu Case <path>` on the left, the launch outcome and the button on the right). 0.6.12 put it at the end of the toolbar, among the view/zoom controls, and the two lower-right attempts (0.6.13's plain row below the drawing, 0.6.14's sticky strip over it) both cost something — a button below the fold, then a full-width floating strip that needed `pointerEvents` carve-outs and a shorter canvas to stay off the fold. The header needs none of that, so the canvas goes back to `70vh` (min `320px`) and the view carries no sticky element or pointer-events exception. Client-only. Guard §12 walks the button's ancestor chain to require the `space-between` top row with the edit controls as its **last** child, and asserts the retired workarounds are gone (no `position: sticky`, no `pointerEvents` on the button); §12's toolbar check still holds that row to `Rendered · Source · − · 100% · + · Fit`. 157 checks |
| 0.6.16 | **The draw.io desktop path becomes configuration instead of code.** The launcher ladder was macOS-shaped (`open -a draw.io`, then the generic handlers), which left a Windows or Linux install depending on a file association. `config/ipss_plugin_env.json` (new, project-level beside `aclf_run.json`) now carries an ordered `drawio.launchers` list — `exe`, `args`, an optional `label` and an optional `platform` tag (`darwin` / `win32` / `linux`, with `macos` / `windows` / `posix` accepted) — and the file being edited is appended to `args`. Entries for this machine's platform are tried first, then the untagged association fallbacks; an entry for another OS is skipped, and each entry still resolves its executable before spawning, so a missing path is a message rather than a failure. `process.platform` supplies the tag hint and is read defensively (the dynamic half imports nothing), and when it is unavailable every launcher is tried in file order. The list compiled into the plugin is exactly the shipped file's list, so deleting the file changes nothing, and a malformed list falls back to those defaults **with a warning** appended to the button's error instead of silently doing nothing. Ships defaults for all three platforms: `open -a draw.io` / `/Applications/draw.io.app` on macOS, `C:\Program Files\draw.io\draw.io.exe` / `cmd.exe /c start ""` on Windows, `drawio` / `/opt/drawio/drawio` / `xdg-open` on Linux. **Host change — needs an app restart.** Guard §13 grew from the ladder to the whole config contract (file matches the constants, per-OS ordering, alias spellings, fallback on a broken config, argv per platform). 168 checks |
| 0.6.17 | The Diagram toolbar's view toggle becomes the **single letters `R` and `S`** — `R · S · − · 100% · + · Fit` — because the spelled-out `Rendered` / `Source` took a third of a row that is otherwise the drawing's zoom controls. The meaning moves into the buttons' `title` and `aria-label` (`Rendered view` / `Source view — the raw draw.io XML`), so nothing is lost on hover and the accessible names stay words; the InterPSS report viewer keeps its full `Rendered` / `Source` labels, which is a different surface with room for them. `R` / `S` are also a touch narrower (`minWidth: 34px`, centred) to match the zoom buttons beside them. Client-only. Guard §12 finds the toolbar row by the new letter, asserts the long labels are gone **from that row only**, and asserts each letter still carries its tooltip and accessible name — a bare letter would otherwise pass a pixel-level review. 170 checks |
| 0.6.18 | **Out-of-band buses are painted red at render time.** A bus whose solved `VoltMag` is outside **[0.9, 1.1] pu** gets a red bar (`#CC0000` fill, `#7F0000` outline) and a red `Bus-N` label in the Diagram tab's inline SVG, and hovering it adds `⚠ |V| outside 0.9–1.1 pu` to the tooltip it already shows — colour alone is not accessible. **The `.drawio` file is never touched**: `DrawioDiagram` takes an optional `alert` map of lowercase `busN` ids and chooses the colours at paint time, the parsed scene keeps its authored grays, and with no `alert` prop the emitted tree is byte-identical to before (asserted). The data arrives over the existing `readCsv` (`_DF_bus.csv` was already whitelisted), paged with an early stop, with the columns located by **header name** — `VoltAng`/`NomVolt` sit right beside `VoltMag`, so a positional read would paint the wrong buses — and the band is checked strictly (`0.9`/`1.1` are in band; blank or non-numeric never flags). No new endpoint and no write path: the desktop app and the generator's PNG preview still show the authored file, which is the point. The label's white paper box stays white (it masks the wires) — both label spellings in the wild are covered, the generated `rounded=0;fillColor=#FFFFFF` rect and the older `text;` cell with `labelBackgroundColor`. Verified against real data: `Ieee14Bus_LargeLoadQ` → exactly Bus-14 (`0.8714`) red; `Ieee14Bus_LargeLoadQ2` → Bus-13/Bus-14; `Ieee118Bus` and `ieee39` → nothing. Client-only. Guard gains §14 (band rule, header-name lookup, scene-limited answers, painting on the real scene plus a synthetic generated-format label, red surviving the theme mapping) and the invariant the design exists for: the parsed scene is unchanged after an alerted render. 188 checks |
| 0.6.19 | **The size limits go up: 2000 → 20000 cells and 2 MiB → 5 MiB.** A 2000-bus case was unreachable for three independent reasons, so all three ceilings move together: the preview's `DRAWIO_MAX_CELLS` (client), the Host's `MAX_DRAWIO_BYTES` (both halves, checked before the read so an oversized file never reaches the RPC payload) and the generator's own self-check (`len(cells) > 20000`). Texas 2K — 2000 bars + 3220 branches + 861 transformer symbols — needs ~10671 cells and ~3 MB of XML, so it now fits all three. The preview is O(cells) React elements: 20000 is roomy without letting a pathological file lock the tab up. Guard gains §15, which pins all three values and exercises the boundary on both sides with a synthetic scene (exactly at the cap the parse gets past the size check; one cell over it fails with `20001 cells (limit 20000)`). Two older assertions became **fixture-relative** in the same pass, because a case diagram is a file the draw.io button invites you to edit: the group-origin check now reads the group's own `mxGeometry` from the file instead of hard-coding `462,306`, and the template comparison compares the drawing's inventory (ids, kinds, edges) rather than its coordinates — a local draw.io edit that nudged transformer group 3 to `x=503` failed both while breaking nothing the preview depends on. 193 checks |
| 0.6.20 | **The draw.io read cap is trimmed to 4 MiB** (`MAX_DRAWIO_BYTES = 4 * 1024 * 1024`, 4 194 304 bytes) in both hosts. 0.6.19 had raised it 2 -> 5 MiB; the largest drawing this workspace produces is the 2000-bus Texas 2K one-line diagram at 2.95 MiB, so 4 MiB keeps a comfortable margin while bounding the RPC payload. Checked **before** the read, so an oversized file never reaches the payload. This is a **Host** value: it takes effect on the next app start, which is also why a client-only refresh still reported the old `limit 2097152`. Host-only. Guard §15 pins the new number in both hosts, together with the 20000-cell preview cap and the generator's own self-check. 193 checks |
| 0.6.21 | **The Diagram tab's zoom readout becomes a picker.** The `100%` label between `−` and `+` is now a `select` (accessible name *Zoom level*) offering **25 / 50 / 75 / 100 / 125 / 150 / 200 / 300 / 400 %**; picking one zooms about the centre of the current view and is clamped by the same limits the wheel uses. A level reached with the wheel or a pinch is listed as an extra entry **and shown as the selection** — the screenshot behind this was at 745 %, and a picker that rounded to 400 % would be lying about the view; the old level stays one click away after picking a preset. `−`, `+` and `Fit` are unchanged, and the picker sits exactly between the two step buttons. Client-only (reload the page; no restart). Guard §12 gains five checks: the presets render, the list is the documented one, every preset round-trips through `drawioZoomPercent`, the control is a *Zoom level* select sitting between `−` and `+` with a handler that does not throw, and a wheel-zoomed (745 %) fixture is shown and offered back in order — three of those a stale screenshot would pass. 200 checks |
| 0.6.22 | **Fit moves into the zoom picker.** The standalone `Fit` button is gone; the picker's last entry is now `Fit`, and while the view is fitted the control reads `Fit` instead of claiming a percentage — so the toolbar row is `R · S · − · [level ▾] · +` and ends at `+`. The two are genuinely different views and both stay available: `Fit` shows the whole page from its origin, while picking `100 %` only rescales about the current centre (from a 300 % view of the top-left corner, `100 %` keeps that corner). `Fit` still clears the drag state. Client-only (reload the page). Guard §12 was re-pointed rather than extended: the row must end at `+` with no Fit button, the option list must be the presets plus `Fit` last, the fixture's fitted state must select `fit`, and the handler must route both a percentage and `fit`. 200 checks |
| 0.6.23 | **Search and Filter buttons in the Diagram toolbar.** Two icon buttons after the zoom controls, each opening a dialog with **OK** / **Cancel** (the fields are a draft; only OK applies, so Cancel cancels). *Search* takes a bus number, a `Bus-N` id, part of a case bus name, or an `A-B` pair, and repaints what it found in the search blue — bar, label text and branch — with a `N buses, M branches` count beside the buttons. *Filter* keeps one area and/or zone (lists read from the case's bus table, zones scoped to the chosen area) and/or only the buses outside 0.9–1.1 pu, hiding everything else **including its branches and transformer symbols**; the funnel stays lit while it is applied and the status text clears it. Both are paint-time overrides like the voltage alert: `hidden` skips a cell, `match` recolours one, and the `.drawio`, the parsed scene and the desktop app see neither. The bus table is fetched on demand, when a dialog opens — the drawing path never waits for it. Client-only (reload the page). Guard §16 is new: every edge must resolve to a bus pair through its transformer group's sibling ring (0 of 25 unresolved) or those branches could never be searched or filtered, plus the query forms, the name match, the `A-B` pair, the area/zone folds, the band filter, that a branch with a hidden end is hidden, and that hidden cells leave the tree while matched ones take the highlight. 226 checks |
| 0.6.24 | **The filter dialog's message follows the dialog, live.** Changing Area, Zone or the band checkbox now rewrites `Showing K of N buses (area 7 COAST, zone 1 BAY CITY).` immediately; before, the sentence was computed from the *applied* filter, so it kept reporting the previous criteria until OK — the screenshot that reported this had `7 COAST` / `1 BAY CITY` selected above a line still reading `area 1, zone 9`. Area and zone are named as the selects show them (numbers alone when the bus table has no name for them), and the toolbar status deliberately keeps the **applied** filter, so the drawing and the status only move on OK and Cancel still cancels. Client-only (reload the page). Guard §12 gains the regression test — a fixture with draft `area 2` over applied `area 1` must render `area 2 SOUTH` in the message while the toolbar still says `area 1` — and §16 pins the named sentence against the numeric toolbar label. 229 checks |
| 0.6.25 | **Branch search is written with an arrow, and the search help is about the case.** `1001->1002` finds the branches between two buses (`-`, `/` and the unicode arrow still work); the dialog's placeholder and help line are now built from the case in front of it — the bus count and range the diagram actually draws, a branch example from its own numbers, and a name from its own bus table, e.g. `14 buses here (Bus-1 to Bus-14). A number or id finds one bus, 1->2 the branches between two, and part of a name like "ODESSA" finds every bus whose name contains it.` When the case has no ACLF result table it says names cannot be searched instead of suggesting one. Client-only (reload the page). Guard §16 pins the arrow spellings (`1->2`, `1-2`, `1/2`, `1→2` all resolve to the same two buses) and the help for a case with names, a case without a table, and no scene at all; §12 renders the dialog's case-specific help. 235 checks |
| 0.6.26 | **One-line diagram config options: a gear dialog editing `config/net_diagram.json`.** The gear sits beside the draw.io button and opens a form for the file's seven settings — bus flag limits and colour, base-case branch flow percent and colour, contingency branch flow percent and colour — with **OK** / **Cancel**; the Host reads and writes the workspace-level file through two new RPCs (`getNetDiagramOptions` / `saveNetDiagramOptions`, 23 methods), sanitizes on save, merges over what is on disk so unknown keys survive, and a missing or unparseable file falls back to the built-in defaults instead of failing the diagram. The drawing then **honours those flags**: buses outside the band are painted `Bus_flag_color` (the bar and its label text — this replaces the hard-coded 0.9–1.1/red of 0.6.18), branch pairs whose highest `Loading%` reaches the base-case percent are painted its colour, and pairs whose worst contingency `LoadingPercent` reaches the contingency percent are painted theirs (a contingency flag outranks a base-case one; a search still outranks every flag). A **flags:** summary beside the toolbar counts each family and reopens the dialog. On Texas 2K that is 12 buses, 32 branch pairs ≥80 % and 8 contingency pairs ≥100 %. Flags stay a preview: no colour reaches the `.drawio`. Host + client, so the new RPCs need an app restart. Guard §17 is new — the shipped file, the client defaults and both hosts must agree on all seven keys, plus the sanitizer, the form validation, the name-based flow readers (parallel circuits take their highest loading) and the paint precedence, plus the flags summary — and §14/§16 were re-pointed from `alert`/`match` to the single `paint` map. 259 checks |
| 0.6.27 | **Every surface that quotes the voltage band reads it from `config/net_diagram.json`.** The Filter dialog's checkbox was the last literal: it said `Only buses with |V| outside 0.9–1.1 pu` no matter what the file said. One helper (`drawioBandText`, which sanitizes whatever it is handed) now spells the band for the checkbox, the filter's own live count (`Showing … (|V| outside 0.95–1.05 pu)`), the toolbar's filter label and the bus tooltip, so a band tuned in the gear dialog shows up everywhere at once — with this workspace's file that is `0.9–1.05 pu`. The guard's own invariant was corrected in the same pass: it had asserted the code's fallback constants *equal* the shipped file, which cannot hold once the file is tuned as intended; it now asserts that the fallback and the file carry the same seven keys, and that the file as written is already valid (the sanitizer changes nothing). Client-only (reload the page). 263 checks |
| 0.6.28 | **Birdseye view.** A thumbnail of the whole drawing sits in the canvas's bottom-right corner with the visible rectangle outlined on it, and **clicking or dragging inside it moves the view** — the answer to "where am I?" once you zoom past fit on a large case. It is not a second render of the diagram: `drawioBirdseyePaths` flattens the scene into **two** svg paths (all branches, all bars), so the 2000-bus Texas 2K scene costs 2 ms, 180 KB and 2 DOM elements instead of another ~10k elements, with `vectorEffect=non-scaling-stroke` keeping the strokes visible at thumbnail scale. `drawioBirdseyeRect` centres the same-size window and holds it inside the drawing (a window as large as the drawing cannot move), out-of-range fractions are clamped, and the thumbnail stops its own pointer events so dragging it never pans the canvas underneath. Client-only (reload the page). Guard §18 is new (path structure, the hop polylines, the empty scene, and the click geometry) and §12 renders the overlay. 275 checks |
| 0.6.29 | **The birdseye view gets a switch.** `config/net_diagram.json` carries one more setting, `Show_birdseye_view` (on by default), and the gear dialog shows it as a checkbox in a new *View* group — so the thumbnail can be turned off without a code change. The canvas does not render the overlay at all when it is off (nothing is hidden with CSS), the file's word spellings count for a hand edit (`"false"`, `0`), a switch is never a validation error, and a save from the dialog writes the key back — the Host preserves keys it does not know, so a running Host from before this release still round-trips it. Client behaviour, Host sanitizer: reload the page for the switch, restart for a fresh Host to validate it itself. Guard §17 covers the switch's defaulting and spellings and §12 renders the dialog's checkbox and the canvas with the setting off. 280 checks |
| 0.6.30 | **The branch tooltip shows its flow loadings.** Hovering a branch in the Diagram tab now ends with `Basecase Loading(%): 13.4%` (the branch table's own `Loading%`, i.e. `|flow| / LimMvaA` — the same field the base-case flags compare against, so tooltip and colour cannot disagree) and `Contingency Loading(%): 118%` **when available**: only the Diagram tab reads the CA result table (for the flags), and that table holds just the branches at or above the CA's `overloadThreshold` (90 % by default), so a lightly loaded branch simply has no contingency line. The connection diagram's tooltips are unchanged: they pass no contingency, and a row without a loading column gets neither line. Percentages are printed to one decimal with a pointless `.0` dropped (`59%`, `118.3%`). Client-only (reload the page). Guard §11 covers both lines, the formatting, either line on its own, and the no-column case. 285 checks |
| 0.6.31 | **The contingency data now actually reaches the tab — two bugs behind "no `Contingency Loading(%)`".** First, `checkResult`'s `files` list never named `<stem>_DF_contingency.csv`, and that list is the only way the tab discovers a result file, so the contingency table was never read: no contingency tooltip line and no blue flags, whatever the CA wrote or the threshold was set to. Both Hosts list it now (whether or not a CA has run — an absent file just means "no contingency data"). Second, the client's load maps were filtered by the **display** thresholds before the tooltip saw them, so a 70 % contingency was hidden whenever the contingency flag was 100 %; the maps now keep every row (max per bus pair) and the **paint and the status counts apply the thresholds**, which also means changing a threshold in the gear dialog repaints without re-reading the CSVs. With the regenerated Texas 2K table (329 branches ≥50 %) that is 110 branches with a worst contingency ≥70 % and 9 at ≥100 %. Host + client: **restart the app** for the file list. Guard pins both Hosts' `checkResult` list and the "available but not painted" rule. 287 checks |
| 0.6.32 | **The Filter dialog gains the two branch-loading criteria** (`Only branches with base-case loading ≥ …` and `… contingency loading ≥ …`, each labelled from `config/net_diagram.json`, so the dialog and the flag colours quote the same numbers). They are the "only" kind of criterion: branches below the threshold go, **and so do the buses that are not an end of a branch that stays** — otherwise ticking one would still draw every bus. Combinations narrow together (area 1 + base-case ≥70% = the overloaded branches inside area 1) and the sentence reports in **branches** when a flow criterion is active, naming both counts when buses were hidden too. The two boxes are offered but not tappable while their table is missing (`no branch table yet` / `no CA table yet`), instead of silently emptying the drawing. Cross-checked against the real Texas 2K data: the filter keeps **86 of 2678** branch pairs at ≥70% and **8** at ≥100% — exactly the counts the flags summary shows, because both read the same maps. The wording follows the mock's intent (`≥` rather than `outside`, which belongs to the voltage band). Client-only (reload the page). 295 checks |
| 0.6.33 | **Preview fidelity: the SVG now draws what the .drawio says.** Comparing the tab with the draw.io app exposed three misread style keys. **`rounded` was treated as a presence, not a value** — every workspace file writes `rounded=0`, so all 2,000 Texas 2K bars rendered as pills (`rx=8`, which SVG clamps to half the 6-unit width) where draw.io draws squares; the value is honoured now, and `rounded=1` rounds by draw.io's `min(w,h) * arcSize` (default 15 %) instead of a fixed 8. **`align`/`verticalAlign`/`spacing` were ignored** — labels were always centred, so Texas 2K's 7,540-wide title box drew its text at x≈3,810 instead of ≈42 (ieee39's title +220, ieee14's legend +(80,36)). **`labelBackgroundColor` was never read** — a `text` cell has no box of its own, so the labels in the five hand-laid diagrams lost the mask that keeps wires out of the glyphs. Guard §19 is new (a fixture for every honoured key plus the tracked reference diagrams), and the existing `rounded=0` fixture now asserts square. Client-only (reload the page). 309 checks |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Tool missing from the registry | Check `$TMPDIR/dsh-interpss-diagnostic.log` for `chat tools registered: interpss_case_load, interpss_network_info, interpss_run_aclf, interpss_case_summary, interpss_run_gvy, interpss_run_ca` and `tools=true`; a row that applied without the `tools` service logs the `NOT registered` line instead |
| Summary absent from a card | The card needs 0.3.4+ (network info) or 0.3.2+ (ACLF). Older cards fall back to the generic row, collapsed by default |
| `alreadyLoaded: true` when a reload was wanted | The tool reuses the held model by design; the tab's **Load** button is the way to force a re-parse |
| The picker shows a different case than the tools use | Fixed in 0.3.19: the picker mirrors the bridge through `getBridgeCase`. On an older plugin, reload the page after a tool load — or pass `case` explicitly |
| `interpss_case_summary` returns no rows | `scope: "net"` is the totals-only mode; pass `bus`, `gen`, `load` or `branch` for rows |
| The summary card is missing entirely | By design since 0.3.12 (ranked scopes since 0.3.11) — no `interpss_case_summary` call renders a card; its value is in the tool result, and the chat report repeats it |
| A ranked summary card shows no counts/mismatch | By design since 0.3.8 — the totals are on the `net` call |
| A summary card shows no case/scope/converged header | By design since 0.3.10 (ranked cards since 0.3.9) — the tool row names the tool and its arguments; the tool result still carries `case` and `converged` for the report |
| Branch ranking looks wrong for loadability | `interpss_case_summary` ranks by flow magnitude; the `Loading%` column in the result CSV is the rating-based measure |
| `script not found: …` | The tool lists the `.gvy` files that exist in that `scripts/` folder; a bare name resolves against the **resolved case's** folder, so pass `case` when the selected case is not the one holding the script |
| `unrecognized script selector` for a path that exists | Only `<case folder>/scripts/` and the workspace `wspace/script/` folder are read; another folder needs the script copied into one of them (or its content passed as inline source) |
| Only the first few scripts of a batch ran | The run stops at the first failure: read `applied` and `failedScript`, fix that script, and re-run — the earlier edits are still on the held model (pass `reload: true` to start from the case file again) |
| Inline Groovy was expected but a file error came back | A value with no whitespace or statement punctuation is read as a file name: add the punctuation (e.g. `x=1`, not `x` alone) or write the script to `<case folder>/scripts/*.gvy` |
| `this bridge cannot evaluate inline Groovy yet` | The uber JAR predates 0.4.9: rebuild it (or pass a `.gvy` file, which the older JAR evaluates) |
| `unrecognized script selector` / `must live in …/scripts/` | Scripts are confined to `<case folder>/scripts/` and must end in `.gvy`; `..` is rejected |
| A script edit vanished | Mutations live on the held model until the case is re-parsed: pass `reload: true`, or load another case and come back |
| A script change had no effect on the totals | Contribute-model networks (`isContributeGenLoadModel()`) carry load on the contribute objects: edit `bus.getContributeLoad(id).loadCP`, not the aggregate `bus.loadP` |
| A branch change had no effect | `branch.status = false` drops the digest's `branches` count immediately (20 → 19 on IEEE 14), so that count is the check — a script whose status line is missing changes nothing there, and the result CSV's `Status` column stays `true` |
| `MissingMethodException` / `noSuchProperty` on `senAlgo` | The `senAlgo` binding needs plugin 0.4.10+ and its own uber JAR; on an older pair, edit the model only or rebuild (`scripts/setup-java-bridge.sh`) and restart `dsh web` |
| `noSuchProperty` / `MissingMethodException` from a script | The failure names the property and the script line; check the JavaBean names in `docs/groovy-script-adapter-architecture.md` |
| `InterPSS is not available in this workspace` | The workspace `README.md` first heading must be exactly `iPSS Agent` |
| `contingencyFile not found` / `monitorFile not found` | The CA argument is wrong or the file is not under `wspace/`; omit it to fall back to `config/ca_run.json`, discovery and the Java N-1 defaults |
| `interpss_run_ca` reports zero overloads | Expected on a lightly loaded case — the default threshold is 90 % of rating; check `threshold` and the monitored set, or pass a lower `overloadThreshold` |
| `overloadThreshold must be a loading percentage between 0 and 1000` | The CA threshold argument is out of range or not a number (the dialog's field validates the same way); pass a percentage such as `80`, or omit it for `config/ca_run.json`/90 |
| The tab's Contingency table is not sorted | Needs 0.4.4+: the tab reads through the same `readCsv` sort, and its Contingency table defaults to `LoadingPercent` descending; Bus/Branch/Gen/Load keep file order |
| A sorted explorer table reorders only some rows | Fixed in 0.4.3: the Host sorts before slicing the page, so paging follows the order; a column it cannot find returns the file order and no sort marker |
| The CA card shows no **Explore result** row | The row needs 0.4.2+ and a settled, successful call; a failed or still-running call, or a replayed older block, falls back to the plain text card |
| Very large case is slow or runs out of memory | The bridge JVM runs with `-Xmx8g` (0.3.20+; `-Xmx4g` before); the CLI is a separate JVM and needs its own `-Xmx` flag. See `Setup.md` |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |
| `Cannot find module 'java-bridge-<platform>'` | The profile lockfile lost java-bridge's optional native package (a `pnpm remove` of the plugin can do this). In `~/.dsh/profiles/web`: `cp pnpm-lock.yaml /tmp/pnpm-lock.web.bak && rm -f pnpm-lock.yaml && pnpm install`, verify `node -e "require.resolve('java-bridge-darwin-arm64')"`, then restart `dsh web` — a failed module load cannot recover inside the running process |
| `no simulation case is selected` | Select a case in the InterPSS tab, or pass `case` explicitly |
| Wrong case used | Trust `source`: `selection` is the tab, `bridge` is the last case the JVM held — pass `case` to be explicit |
| `Converged: false` | Tune `maxIterations` / `tolerance` / limit-control flags in the case-folder `config/aclf_run.json`; report the mismatch bus rather than retrying unchanged |
| A change to `lib/client.js` has no effect | The Client half is served with the plugin bundle: reinstall the package, restart `dsh web`, then hard-reload the page |
