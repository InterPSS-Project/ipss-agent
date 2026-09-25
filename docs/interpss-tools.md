# InterPSS Chat Tools

The persistent DSH plugin (`@deepseek-ai/dsh-interpss`) registers model **Tools**, so the
InterPSS capability is reachable from the chat agent and not only from the InterPSS tab.
This document covers what each tool accepts, what it returns, how its card renders, and how
the tools relate to the tab, the `/api` RPCs, and the agent skills.

Reference implementation: `interpss-persistent/lib/index.js` (Host) and
`interpss-persistent/lib/client.js` (Client). Current version: **0.4.0**.

## Tool surface

| Tool | Purpose | Side effects |
| --- | --- | --- |
| `interpss_case_load` | Load the selected case into the embedded bridge | Parses the case file when the bridge does not already hold it; no-op otherwise |
| `interpss_network_info` | Show the network information of a simulation case | Loads the case into the embedded JVM when it is not already held |
| `interpss_run_aclf` | Run an AC load flow (ACLF) and report convergence | Writes `<stem>_DF_{bus,branch,gen,load}.csv` and `<stem>_network_info.txt` under `wspace/<case dir>/result/` |
| `interpss_case_summary` | Summarize the bridge-held case: net totals, or a top-N ranking by scope | None — reads the in-memory model |
| `interpss_run_ca` | DC contingency analysis (N-1 screening) with the CA dialog bypassed, and report the overload summary | Writes `<stem>_DF_contingency.csv` under `wspace/<case dir>/result/` |
| `interpss_run_gvy` | Apply a Groovy (`.gvy`) scenario script from the case folder's `scripts/` directory to the bridge-held case | Mutates the held model in place (no rollback); `reload: true` re-parses the case first |

All six are registered once at the end of `apply()` and are **global to the host process**;
every call is gated on the iPSS Agent workspace check, so a non-`iPSS Agent` workspace gets an
explicit failure message rather than a missing tool.

`interpss_case_load` is the explicit first step: its description, the other tools'
descriptions, and the `ipss-case-info` / `ipss-case-aclf` skills all say to call it before the
others when the selected case has not been loaded yet. Nothing enforces the order — each tool
still loads on demand, so skipping the step is safe, just less explicit.

```js
// lib/index.js — apply()
const tools = ctx.get('tools')
if (tools !== undefined) {
  const chatToolDefs = [caseLoadTool(ctx), networkInfoTool(ctx), runAclfTool(ctx), caseSummaryTool(ctx)]
  for (const definition of chatToolDefs) {
    ctx.effect(() => tools.register(definition))
  }
  diag('chat tools registered: ' + chatToolDefs.map((definition) => definition.name).join(', '))
}
```

`ctx.get('tools')` is guarded rather than injected (the row only injects `typert`), and both
outcomes are recorded in `$TMPDIR/dsh-interpss-diagnostic.log`.

## Case selection

Both tools take one optional argument, `case`, and otherwise resolve the current case through
the shared `resolveToolCase()` helper, in this order:

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
| Input | `{ script: string, case?: string, reload?: boolean }` — `script` is required |
| Output | `{ ok, case, source, format, script, reload?, elapsedMs?, returnValue?, returnType?, stdout?, line?, buses?, branches?, loadMw?, generationMw?, loadMwBefore?, generationMwBefore?, lfConverged?, error? }` |
| `presentationMeta` | `{ ok, case, source, script }` |
| Card key | `interpss_run_gvy` (0.3.17+) |

Applies a Groovy script to the **live** `AclfNetwork` held in the bridge, using
`org.interpss.script.gvy.AclfNetGvyScriptProcessor` (see
[groovy-script-adapter-architecture.md](groovy-script-adapter-architecture.md)): the network is bound
as `aclfnet`, `Complex` is pre-imported, and property assignment maps to JavaBean setters
(`bus.loadP = 0.18`, `branch.status = false`, `load.loadCP = new Complex(p, q)`).

**Where the script comes from.** A bare file name resolves into the resolved case's own folder:

| `script` form | Resolves to |
| --- | --- |
| `ieee14_adjBus14.gvy` | `wspace/<case dir>/scripts/ieee14_adjBus14.gvy` |
| `data/ieee/Ieee14Bus/scripts/ieee14_adjBranch1_2.gvy` | that path, verbatim |
| an absolute path containing `/wspace/data/` | the same file, converted to the `data/…` form |

Anything else — a path outside a `scripts/` directory, a non-`.gvy` file, a `..` segment — is
rejected before the bridge is called, and a missing file fails with the names of the `.gvy` files
that *are* there. The Java side re-checks the same rule (`.gvy`, regular file, under
`<case folder>/scripts/`, ≤ 256 KB) so a direct bridge caller cannot bypass it.

**What it returns.** The digest is measured around the evaluation, so a mutation-only script still
shows its effect: `loadMw` / `generationMw` after the run, `loadMwBefore` / `generationMwBefore`
before it, plus `buses`, `branches` and `lfConverged`. The script's last expression is reported as
`returnValue` **only when it is a scalar** (`String`, `Number`, `Boolean`, `Character`, `Complex`);
a model object is never serialized — its simple class name comes back as `returnType` instead. Extra
`println` output from the script is captured and returned as `stdout` (truncated at 8000 characters).

**Mutating semantics** (the whole point, and the main caveat):

- Edits happen **in place** on the held model and are **never rolled back**; a script that fails
  halfway keeps what it already changed, and the failure carries `line` (the script line) so the
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
| Browse results | Bus/Branch/Gen/Load tabs | card's Explore row | `interpss/readCsv` |
| Generate report | Report button | card's Report button | `interpss/runReport` |

The tools add **no** `/api` endpoint of their own. `METHODS` had gained only the CA-dialog methods
(`listCaFiles`, `getCaOptions`, `saveCaOptions`); 0.3.19 adds `getBridgeCase`, which the tab's picker
polls and no tool calls — 18 in total.
The one Host RPC signature that grew is `runReport`, which now accepts an optional
`reportType` (`aclf` | `nerc`) that takes precedence over the contingency-based auto rule.

The bridge's `lastLoadedAbs` mirrors `IpssAgentBridge.loadedInput` and is updated by
`loadCase`, `runAclf`, `runGvy` and `runContingency` — every JVM load goes through this module's
`javaBridge` provider, so the mirror cannot drift in practice. It backs the `bridge` source in
case resolution, `reused` in `caseInfo`, and (0.3.19) the `case` that `getBridgeCase` hands the
tab's picker.

## Related skills

| Skill | Use |
| --- | --- |
| `ipss-case-load` | Load a case into the bridge and report its counts (wraps `interpss_case_load`) |
| `ipss-case-info` | Report the current case's network info (wraps `interpss_network_info`) |
| `ipss-case-aclf` | Run ACLF for the current case (wraps `interpss_run_aclf`) |
| `ipss-case-script` | Apply a `.gvy` scenario script to the current case (wraps `interpss_run_gvy`) |
| `ipss-case-ca` | DC contingency analysis for the current case, dialog-free (wraps `interpss_run_ca`) |
| `ipss-sim` | Full simulation and reporting workflow through the Java CLI (`IpssCmd`) |
| `nerc-report-html`, `nerc-report-slides` | Follow-on artifacts from a NERC report |

Canonical skill sources live in `.agents/skills/<name>/SKILL.md`; `.claude/commands/<name>.md`
carries the Claude Code slash command for each.

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
| 0.4.1 | `interpss_run_ca`: DC contingency analysis from chat with the CA dialog bypassed (explicit inputs → `ca_run.json` → case-folder discovery → N-1 defaults), plus its card and the `ipss-case-ca` skill |
| 0.4.0 | Version-only release: the first 0.4.x, carrying 0.3.17–0.3.23 unchanged (the `interpss_run_gvy` tool and its skill, the `ipss-case-load` skill, `wspace/…` selector spellings, the Simu Case picker + `✓ Loaded:` sync, `-Xmx8g`, and the load card's confirmation line) |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Tool missing from the registry | Check `$TMPDIR/dsh-interpss-diagnostic.log` for `chat tools registered: interpss_case_load, interpss_network_info, interpss_run_aclf, interpss_case_summary, interpss_run_gvy` and `tools=true`; a row that applied without the `tools` service logs the `NOT registered` line instead |
| Summary absent from a card | The card needs 0.3.4+ (network info) or 0.3.2+ (ACLF). Older cards fall back to the generic row, collapsed by default |
| `alreadyLoaded: true` when a reload was wanted | The tool reuses the held model by design; the tab's **Load** button is the way to force a re-parse |
| The picker shows a different case than the tools use | Fixed in 0.3.19: the picker mirrors the bridge through `getBridgeCase`. On an older plugin, reload the page after a tool load — or pass `case` explicitly |
| `interpss_case_summary` returns no rows | `scope: "net"` is the totals-only mode; pass `bus`, `gen`, `load` or `branch` for rows |
| The summary card is missing entirely | By design since 0.3.12 (ranked scopes since 0.3.11) — no `interpss_case_summary` call renders a card; its value is in the tool result, and the chat report repeats it |
| A ranked summary card shows no counts/mismatch | By design since 0.3.8 — the totals are on the `net` call |
| A summary card shows no case/scope/converged header | By design since 0.3.10 (ranked cards since 0.3.9) — the tool row names the tool and its arguments; the tool result still carries `case` and `converged` for the report |
| Branch ranking looks wrong for loadability | `interpss_case_summary` ranks by flow magnitude; the `Loading%` column in the result CSV is the rating-based measure |
| `script not found: …` | The tool lists the `.gvy` files that exist in that `scripts/` folder; a bare name resolves against the **resolved case's** folder, so pass `case` when the selected case is not the one holding the script |
| `unrecognized script selector` / `must live in …/scripts/` | Scripts are confined to `<case folder>/scripts/` and must end in `.gvy`; `..` is rejected |
| A script edit vanished | Mutations live on the held model until the case is re-parsed: pass `reload: true`, or load another case and come back |
| A script change had no effect on the totals | Contribute-model networks (`isContributeGenLoadModel()`) carry load on the contribute objects: edit `bus.getContributeLoad(id).loadCP`, not the aggregate `bus.loadP` |
| A branch change had no effect | `branch.status = false` drops the digest's `branches` count immediately (20 → 19 on IEEE 14), so that count is the check — a script whose status line is missing changes nothing there, and the result CSV's `Status` column stays `true` |
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
