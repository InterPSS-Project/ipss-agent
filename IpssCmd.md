# IpssCmd — Native Java CLI

InterPSS simulations (AC load flow and DC contingency analysis) are run through a
native Java command-line tool, `IpssCmd` (`org.interpss.agent.IpssCmd`), packaged
as a self-contained Uber JAR. No Python, JPype, or JVM-path configuration is
required to run the simulations.

## Build

From the **project root** (the directory that contains `wspace/`, `src/`,
`config/`, and `lib/`):

```bash
./mvnw -q clean package
```

This compiles the Java sources and produces the self-contained Uber JAR:

```
target/ipss-agent-cmd-1.0.0-uber.jar
```

The Uber JAR bundles the InterPSS runtime, its dependencies, and the CLI classes;
its manifest declares `org.interpss.agent.IpssCmd` as the main class.

## Run

Run commands from `wspace/` (paths are relative to `wspace/`):

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar <simutype> <format> <input> [<cont_file> <monitor_file>]
```

| Argument                 | Values         | Description                                          |
| ------------------------ | -------------- | ---------------------------------------------------- |
| `simutype`               | `aclf`, `ca`   | Simulation type: load flow or contingency analysis   |
| `format`                 | `ieee`, `psse`, `bpa` | Input file format                              |
| `input`                  | path           | Case file path (relative to `wspace/`)               |
| `cont_file` / `monitor_file` | path       | Optional contingency / monitored-branches JSON (relative to `wspace/`); each overrides the matching `ca_run.json` entry for `ca` |

## Run ACLF (AC Load Flow)

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```

For ACLF, `IpssCmd` resolves `aclf_run.json` with a two-tier lookup:

1. **Case-specific (preferred):** `wspace/<input_parent>/config/aclf_run.json` if it exists.
2. **Project default (fallback):** `config/aclf_run.json` at the project root.

It loads the file with `AclfRunConfigRec.loadAclfRunConfig` and applies it with
`configAclfRun`. The line `Using config file: ...` on stderr shows which path was
used. Adjust NR settings, limits, and related fields in that JSON.

## Run Contingency Analysis (CA)

Both contingency inputs are optional. `IpssCmd` resolves each of them
independently, most specific first:

1. **Explicit CLI argument** — `cont_file` / `monitor_file`; must exist.
2. **Case `ca_run.json`** — `wspace/<input_parent>/config/ca_run.json`, for whichever
   section it selects with `custom`. The line `Using ca_run.json: ...` on stderr
   shows the file it read. A named file that does not exist is an error.
3. **Built-in defaults** — all N-1 branch outages, every branch monitored.

Unlike `aclf_run.json` there is no project-level default: contingency lists are
case-specific. The case `ca_run.json` is the same file the InterPSS tab's **CA**
dialog writes, so a run configured in the GUI is reproduced by the CLI.

```json
{
  "contingencyMode": "custom",
  "contingencyFile": "data/psse/Texas2K/2k_contingencies_115kVAbove.json",
  "monitorMode": "custom",
  "monitoredBranchFile": "data/psse/Texas2K/2k_monitored_branches.json",
  "overloadThreshold": 90
}
```

| Key | Values | Meaning |
| --- | --- | --- |
| `contingencyMode` | `all` (default) \| `custom` | N-1 outages for every branch, or the listed contingencies |
| `contingencyFile` | path under `wspace/` | Contingency JSON (`{"contingencies": [...]}`); required when `contingencyMode` is `custom` |
| `monitorMode` | `all` (default) \| `custom` | Monitor every branch, or only the listed ones |
| `monitoredBranchFile` | path under `wspace/` | Monitored-branch JSON (`{"monitored_branches": [...]}`); required when `monitorMode` is `custom` |
| `overloadThreshold` | `0 < t <= 1000` (default `90`) | Loading percentage at or above which a monitored branch is reported as an overload; the InterPSS tab's **CA** dialog collects the same value as **Over Loading Threshold(%)** |

Example using the Texas 2K case files shipped under `wspace/data/psse/Texas2K/`:

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

For another IEEE CDF case, supply your own `contingency.json` and `monitored.json`
paths after the `.ieee` file, using `ca ieee ...`, or drop a `ca_run.json` beside
the case and run `ca ieee <case>` with no file arguments.

## Run Generator Redispatch (OptAdj)

`optadj` relieves branch thermal overloads by redispatching generator active power: an SSA scan
collects the branches (or post-contingency pairs) above a scan percentage, a linear program moves
the control generators so the monitored loadings stay under an enforce percentage, and the same
monitored set is re-checked. The method and its prerequisites are documented in
[docs/gen_opt_adjustment.md](docs/gen_opt_adjustment.md).

```bash
cd wspace
# Basecase (pre-contingency): from the case's config/opt_adj_run.json, else 50 % scan / 100 % enforce
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar optadj ieee data/ieee/ieee39/ieee39.ieee

# N-1 (post-contingency) with an explicit contingency file
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar optadj ieee data/ieee/ieee39/ieee39.ieee \
  data/ieee/ieee39/contingencies.json
```

`optadj` takes **at most one** positional file (the N-1 contingency JSON; a monitor file is
rejected — the SSA scan is the monitored set). A basecase run refuses a contingency file. The case
folder's `config/opt_adj_run.json` (the same file the chat tool reads and writes) overrides the
built-in defaults:

| Key | Values | Meaning |
| --- | --- | --- |
| `optAdjType` | `genAdjBaseCase` (default) \| `genAdjCA_N-1` | Relieve pre-contingency (basecase) or post-contingency (single branch outage) loading |
| `scanLoadingThreshold` | `0 < t <= 1000`; unset = 50 basecase / 90 N-1 | Candidate-collection percentage |
| `optAdjLoadingThreshold` | `0 < t <= 1000` (default `100`) | Percentage the optimizer enforces |
| `contingencyMode` | `all` (default) \| `custom` | All N-1 outages, or the listed contingencies (`genAdjCA_N-1` only) |
| `contingencyFile` | path under `wspace/` | The contingency JSON; required when the mode is `custom` |
| `sparseSenMatrix` | `true` (default) \| `false` | Sensitivity path passed to the LP's optimizer: sparse, or dense |
| `threads` | `>= 0` (default `0`) | SSA workers; `0` = one per available processor |

The N-1 mode token was renamed from `genAdjCaN_1` to `genAdjCA_N-1` in 0.7.8. The record accepts the
canonical token only; the DSH Host folds the retired spelling onto it, so an older `opt_adj_run.json`
still runs through the plugin, while a CLI run reads the file directly and rejects it.

Two preconditions are refused with the reason rather than producing a meaningless run: every active
generator needs a **P gen limit** and every branch a **rating MVA 1** (the scan divides the flow by
it). The IEEE 39 fixture carries neither — apply
`wspace/data/ieee/ieee39/scripts/ieee39_limit_setup.gvy` first. Note that the run **overwrites the
network's generator P in memory**; the CLI process exits, so nothing persists to the case file.

## Outputs

Results are written under `wspace/<input_parent>/result/`:

- `<stem>_network_info.txt`
- `<stem>_DF_bus.csv`
- `<stem>_DF_branch.csv`
- `<stem>_DF_gen.csv`
- `<stem>_DF_load.csv`
- `<stem>_DF_contingency.csv` (CA only)
- `<stem>_DF_optadj_gen.csv` + `<stem>_DF_optadj_branch.csv` (OptAdj basecase)
- `<stem>_DF_optadj_N1_gen.csv` + `<stem>_DF_optadj_N1_branch.csv` (OptAdj N-1, `genAdjCA_N-1`)

See [Setup.md](Setup.md) for the full layout and the report generators in
[GenReport.md](GenReport.md).
