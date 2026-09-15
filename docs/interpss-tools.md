# InterPSS Chat Tools

The persistent DSH plugin (`@deepseek-ai/dsh-interpss`) registers model **Tools**, so the
InterPSS capability is reachable from the chat agent and not only from the InterPSS tab.
This document covers what each tool accepts, what it returns, how its card renders, and how
the tools relate to the tab, the `/api` RPCs, and the agent skills.

Reference implementation: `interpss-persistent/lib/index.js` (Host) and
`interpss-persistent/lib/client.js` (Client). Current version: **0.3.12**.

## Tool surface

| Tool | Purpose | Side effects |
| --- | --- | --- |
| `interpss_case_load` | Load the selected case into the embedded bridge | Parses the case file when the bridge does not already hold it; no-op otherwise |
| `interpss_network_info` | Show the network information of a simulation case | Loads the case into the embedded JVM when it is not already held |
| `interpss_run_aclf` | Run an AC load flow (ACLF) and report convergence | Writes `<stem>_DF_{bus,branch,gen,load}.csv` and `<stem>_network_info.txt` under `wspace/<case dir>/result/` |
| `interpss_case_summary` | Summarize the bridge-held case: net totals, or a top-N ranking by scope | None — reads the in-memory model |

All four are registered once at the end of `apply()` and are **global to the host process**;
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
- Solver options come from the **case-folder** `aclf_run.json` when present, otherwise
  `config/aclf_run.json` — the same two-tier rule as `ProjectPaths`, shared with the tab's
  `runAclf` RPC through `resolveAclfConfigPath()`.
- Writes `<stem>_DF_bus.csv`, `<stem>_DF_branch.csv`, `<stem>_DF_gen.csv`,
  `<stem>_DF_load.csv` and `<stem>_network_info.txt` under `wspace/<case dir>/result/`.
  `*_DF_contingency.csv` is untouched — that comes from a contingency run.
- A solve that does **not** converge is still a successful call: `ok: true, converged: false`.
  The mismatch and its bus are in the network-info text; do not report the case as solved and
  do not retry the identical call unchanged.
- Large cases (PSS/E 2K-bus and up) can take minutes.

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

## Tool cards

Four cards are registered in the session-scoped `tool.call.toolview` slot, keyed by the wire
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
```

The three short-result tools share one implementation: `toolTextCard(label)` returns a hook-free
component that renders the settled text directly (or a title line while running), and
`NetworkInfoCard` / `CaseLoadCard` / `CaseSummaryCard` are that factory bound to their labels. Only
the ACLF card needs hooks, because it fetches rows.

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
| Case totals / top-N ranking | — (the tab has no equivalent) | `interpss_case_summary` | `interpss/summarizeResult` |
| Network info | Network info panel | `interpss_network_info` | `interpss/getNetworkInfo`, `javaBridge.caseInfo` |
| Run ACLF | ACLF button | `interpss_run_aclf` | `interpss/runAclf` |
| Browse results | Bus/Branch/Gen/Load tabs | card's Explore row | `interpss/readCsv` |
| Generate report | Report button | card's Report button | `interpss/runReport` |

The tools add **no** `/api` endpoint: `METHODS` still lists the same 14 methods. The one Host
RPC signature that grew is `runReport`, which now accepts an optional `reportType`
(`aclf` | `nerc`) that takes precedence over the contingency-based auto rule.

The bridge's `lastLoadedAbs` mirrors `IpssAgentBridge.loadedInput` and is updated by
`loadCase`, `runAclf` and `runContingency` — every JVM load goes through this module's
`javaBridge` provider, so the mirror cannot drift in practice. It backs the `bridge` source in
case resolution and `reused` in `caseInfo`.

## Related skills

| Skill | Use |
| --- | --- |
| `ipss-case-info` | Report the current case's network info (wraps `interpss_network_info`) |
| `ipss-case-aclf` | Run ACLF for the current case (wraps `interpss_run_aclf`) |
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

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Tool missing from the registry | Check `$TMPDIR/dsh-interpss-diagnostic.log` for `chat tools registered: interpss_case_load, interpss_network_info, interpss_run_aclf` and `tools=true`; a row that applied without the `tools` service logs the `NOT registered` line instead |
| Summary absent from a card | The card needs 0.3.4+ (network info) or 0.3.2+ (ACLF). Older cards fall back to the generic row, collapsed by default |
| `alreadyLoaded: true` when a reload was wanted | The tool reuses the held model by design; the tab's **Load** button is the way to force a re-parse |
| `interpss_case_summary` returns no rows | `scope: "net"` is the totals-only mode; pass `bus`, `gen`, `load` or `branch` for rows |
| The summary card is missing entirely | By design since 0.3.12 (ranked scopes since 0.3.11) — no `interpss_case_summary` call renders a card; its value is in the tool result, and the chat report repeats it |
| A ranked summary card shows no counts/mismatch | By design since 0.3.8 — the totals are on the `net` call |
| A summary card shows no case/scope/converged header | By design since 0.3.10 (ranked cards since 0.3.9) — the tool row names the tool and its arguments; the tool result still carries `case` and `converged` for the report |
| Branch ranking looks wrong for loadability | `interpss_case_summary` ranks by flow magnitude; the `Loading%` column in the result CSV is the rating-based measure |
| `InterPSS is not available in this workspace` | The workspace `README.md` first heading must be exactly `iPSS Agent` |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |
| `no simulation case is selected` | Select a case in the InterPSS tab, or pass `case` explicitly |
| Wrong case used | Trust `source`: `selection` is the tab, `bridge` is the last case the JVM held — pass `case` to be explicit |
| `Converged: false` | Tune `maxIterations` / `tolerance` / limit-control flags in the case-folder `aclf_run.json`; report the mismatch bus rather than retrying unchanged |
| A change to `lib/client.js` has no effect | The Client half is served with the plugin bundle: reinstall the package, restart `dsh web`, then hard-reload the page |
