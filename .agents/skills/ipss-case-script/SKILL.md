---
name: ipss-case-script
description: Use when asked to run a Groovy (.gvy) scenario script against the current InterPSS simulation case — a what-if edit to loads, branch impedance or status, or network metadata, applied before an AC load flow — including running one of the scripts in the case folder's scripts/ directory.
metadata:
  short-description: Run a case script
---

# InterPSS Case Script

Run a Groovy `.gvy` script against the **current simulation case** — the case selected in the
InterPSS tab — and report what it changed. In DeepSeek Harness this is a single tool call; other
agents use [Fallbacks](#fallbacks).

The script **edits** the model and never solves it: follow with `$ipss-case-aclf` when the edited
case needs solved values. See
[docs/groovy-script-adapter-architecture.md](../../../docs/groovy-script-adapter-architecture.md)
for the adapter itself (`org.interpss.script.gvy`).

## Preferred path (DeepSeek Harness)

### Step 0 — load the selected case

```
interpss_case_load()
```

A no-op reporting `alreadyLoaded: true` when the bridge already holds the case, so it is safe to call
unconditionally. The script tool loads on demand too; this step just makes the load explicit and
reports the bus/branch counts.

### Step 1 — run the script

```
interpss_run_gvy({ script: 'ieee14_adjBus14.gvy' })
```

Do not ask which case to use: with no `case` argument the tool resolves the case selected in the
InterPSS tab. Pass `case` only to target a different case — **the script is always resolved inside
that case's own `scripts/` folder**, so a script that lives with another case needs that case named.

### Where the script comes from

| `script` form | Resolves to |
|---|---|
| `ieee14_adjBus14.gvy` | `wspace/<case dir>/scripts/ieee14_adjBus14.gvy` |
| `data/ieee/Ieee14Bus/scripts/ieee14_adjBranch1_2.gvy` | that path, verbatim |
| `wspace/data/ieee/Ieee14Bus/scripts/ieee14_adjBranch1_2.gvy` | the same, with the `wspace/` prefix stripped (plugin 0.3.18) |
| an absolute path containing `/wspace/data/…/scripts/…` | the same file, converted to the `data/…` form |

The same three spellings work for the `case` argument. Anything else is refused before the bridge is
called: a path outside a `scripts/` directory, a non-`.gvy` file, a `..` segment. A missing file fails with the names of the `.gvy` files that *are*
in that folder — use them rather than guessing.

### What the script sees

The live network is bound as **`aclfnet`** (lowercase, matching the binding key) and `Complex` is
pre-imported, so a script needs no imports:

```groovy
bus = aclfnet.getBus('Bus14');
load = bus.getContributeLoad('Bus14-L1');
load.loadCP = new Complex(0.18, 0.07);
```

Groovy property assignment maps to JavaBean setters on the InterPSS objects:

| Script | Effect |
|---|---|
| `aclfnet.id = 'Modified'` | `net.setId("Modified")` |
| `bus.loadP = 0.18` | `bus.setLoadP(0.18)` — the aggregate load |
| `load.loadCP = new Complex(p, q)` | `load.setLoadCP(...)` — one contribute load |
| `branch.z = new Complex(r, x)` | `branch.setZ(...)` |
| `branch.status = false` | deactivates the branch |

Common lookups: `aclfnet.getBus(id)`, `aclfnet.getBranch(fromBusId, toBusId, circuitId)`,
`bus.getContributeLoad(id)`. On a **contribute** model (`isContributeGenLoadModel()` — IEEE 14 and
the PSS/E cases are) the aggregate `bus.loadP` setter does not move the case totals: edit
`getContributeLoad(...).loadCP` instead.

### Reading the result

The digest is measured around the evaluation, so a mutation-only script still shows its effect:

| Field | Meaning |
|---|---|
| `loadMw` / `generationMw`, `loadMwBefore` / `generationMwBefore` | Case totals after and before the run, in MW |
| `buses`, `branches` | Active equipment after the run |
| `lfConverged` | Whether the held model is solved — `not solved` until `interpss_run_aclf` runs |
| `returnValue` | The script's last expression, **only when it is a scalar** (`String`, `Number`, `Boolean`, `Complex`) |
| `returnType` | Simple class name when the script returned a model object (never serialized) |
| `stdout` | Anything the script printed, truncated at 8000 characters (only shown when non-empty) |
| `error` + `line` | Failure message and the failing script line |

### Step 2 — solve when solved values are needed

```
interpss_run_aclf()
```

The script edit lives on the held model, so ACLF solves the edited case and writes the result CSVs
and network info under `wspace/<case dir>/result/` (see `$ipss-case-aclf`).

### Replying after a run

The card **is** the result: it carries the script, the case and its `source`, the digest with the
load/generation deltas and the script's return value or stdout. Do not restate it. Reply with at
most a one-line confirmation that the script was applied.

Add prose only when the caller needs something the card cannot carry:

- the script **failed** — report the property/method and the script line;
- the digest shows **no change** although one was expected — the edit was already applied (assign
  absolute values or pass `reload: true`), or the script edits a contribute load while the aggregate
  value was expected;
- a **decision** is required — solving the edited case now, or resetting it with `reload: true`.

### Choosing the right tool

| Want | Use |
|---|---|
| Apply a scenario edit to the held case | `interpss_run_gvy` |
| Solve the (edited) case and write result CSVs | `interpss_run_aclf` |
| Show the loaded case's network info, without solving | `interpss_network_info` |
| Summarize the case — totals, or a top-N ranking | `interpss_case_summary` |

## Mutating semantics

- Edits are **in place** on the bridge-held model and are **never rolled back**. A script that fails
  halfway keeps what it already changed — check the digest, and re-load or reset when in doubt.
- Running the same script twice applies it twice, unless it assigns absolute values. `reload: true`
  re-parses the case from disk **before** evaluating, which is the only reset available from chat
  (the Java `reload` flag; the tab's **Load** button does the same for the tab).
- `.gvy` files are executable code with full access to the bound model, and there is no sandbox:
  only run scripts you trust.
- The script runs against whatever `AclfNetwork` the bridge holds — base case or already solved.

## Fallbacks

The Groovy adapter is reachable only through the DeepSeek Harness bridge today: `IpssCmd` has no
`gvy` subcommand, so Codex and the Claude Code CLI cannot run a script through the DSH tool. Apply
the same edit in one JVM with the project's uber JAR, then solve it there (the CLI's `aclf` command
would re-parse the case and lose the edit):

```bash
jshell --class-path target/ipss-agent-cmd-1.0.0-uber.jar
```

```java
var net = org.interpss.agent.input.NetworkLoader.loadNetwork(
    "ieee", "<abs>/wspace/data/ieee/Ieee14Bus/ieee14.ieee");
org.interpss.agent.runner.GvyScriptRunner.runOnNet(net,
    java.nio.file.Path.of("<abs>/wspace/data/ieee/Ieee14Bus/scripts/ieee14_adjBus14.gvy"));
org.interpss.agent.runner.AclfRunner.runOnNet(net,
    "<abs>/config/aclf_run.json", java.nio.file.Path.of("<abs>/wspace/data/ieee/Ieee14Bus/result"),
    "ieee14");
```

`GvyScriptRunner` enforces the same rule as the tool: the script must be a `.gvy` regular file under
the case folder's `scripts/` directory. State clearly that such a run happens outside the bridge, so
the chat tools keep reporting the model the bridge holds, not the edited one.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `script not found: …` | The message lists the `.gvy` files in that `scripts/` folder; a bare name resolves against the **resolved case's** folder, so pass `case` when the selected case is not the one holding the script |
| `unrecognized script selector` / `the script must live in …/scripts/` | Scripts are confined to `<case folder>/scripts/` and must end in `.gvy`; `..` is rejected |
| `MissingPropertyException` / `noSuchProperty` | The failure names the property and the line: check the JavaBean names above (`loadCP`, `z`, `status`) |
| A script edit had no effect on the totals | Contribute-model network: edit `bus.getContributeLoad(id).loadCP`, not the aggregate `bus.loadP` |
| The edit vanished | The case was re-parsed (another `interpss_case_load` with `reload`, the tab's **Load**, or a different case loaded); re-run the script |
| `InterPSS is not available in this workspace` | The workspace `README.md` first heading must be exactly `iPSS Agent` |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |

## Related

- `$ipss-case-aclf` — solve the edited case and write the result files
- `$ipss-case-info` — show the loaded case's network info
- `$ipss-case-summary` — summarize the case, edited or not
- [docs/groovy-script-adapter-architecture.md](../../../docs/groovy-script-adapter-architecture.md) — the adapter, binding and evaluation semantics
- [docs/interpss-tools.md](../../../docs/interpss-tools.md) — the `interpss_run_gvy` tool contract
