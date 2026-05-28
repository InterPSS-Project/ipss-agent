# `IpssCmd` — InterPSS command-line tool

Native Java CLI for AC load flow (ACLF) and DC contingency analysis. Build once at the project root, then run from `wspace/`. See [Setup.md](Setup.md) for JAR layout and prerequisites.

## Build

```bash
./mvnw package
```

Requires `lib/ipss_runnable.jar` and populated `lib/deps/` (see [Setup.md](Setup.md)).

## Command syntax

Run from `wspace/` (paths are relative to `wspace/`):

```
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar <simutype> <format> <input> [<cont_file> <monitor_file>]
```


| Argument | Values | Description |
| -------- | ------ | ----------- |
| `simutype` | `aclf`, `ca` | Simulation type |
| `format` | `ieee`, `psse` | Input file format |
| `input` | path | Case file under `wspace/` |
| `cont_file` | path | Contingency JSON (required for `ca`) |
| `monitor_file` | path | Monitored-branches JSON (required for `ca`) |

Optional JVM flags (large cases):

```bash
java -Xmx8g -Dlog4j.configurationFile=../config/log4j2.xml -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar ...
```

## ACLF run configuration

For ACLF, `IpssCmd` resolves `aclf_run.json` in this order:

1. **Case-specific:** `wspace/<input_parent>/config/aclf_run.json` if it exists.
2. Otherwise **project default:** `config/aclf_run.json` at the project root.

The tool prints `Using config file: ...` to stdout. Settings are loaded with `AclfRunConfigRec.loadAclfRunConfig` and applied via `configAclfRun`. Edit the JSON to tune NR iterations, tolerance, and limit controls without recompiling.

## Run ACLF (AC load flow)

IEEE CDF:

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
```

PSS/E RAW:

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```

**Outputs** under `wspace/<input_parent>/result/`:

- `{stem}_network_info.txt`
- `{stem}_DF_bus.csv`, `{stem}_DF_gen.csv`, `{stem}_DF_load.csv`, `{stem}_DF_branch.csv`

## Run contingency analysis

CA requires contingency and monitored-branch JSON paths. Texas 2K example:

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

**Additional output:** `{stem}_DF_contingency.csv` in the same `result/` folder.

For IEEE CDF cases, supply your own contingency and monitored JSON paths after the `.ieee` file (`ca ieee ...`).
