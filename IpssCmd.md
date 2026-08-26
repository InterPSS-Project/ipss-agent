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
| `format`                 | `ieee`, `psse` | Input file format                                    |
| `input`                  | path           | Case file path (relative to `wspace/`)               |
| `cont_file` / `monitor_file` | path       | Contingency / monitored-branches JSON (required for `ca`) |

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

CA requires contingency and monitored-branches JSON paths in addition to the case
file. Example using the Texas 2K case files shipped under `wspace/data/psse/Texas2K/`:

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

For another IEEE CDF case, supply your own `contingency.json` and `monitored.json`
paths after the `.ieee` file, using `ca ieee ...`.

## Outputs

Results are written under `wspace/<input_parent>/result/`:

- `<stem>_network_info.txt`
- `<stem>_DF_bus.csv`
- `<stem>_DF_branch.csv`
- `<stem>_DF_gen.csv`
- `<stem>_DF_load.csv`
- `<stem>_DF_contingency.csv` (CA only)

See [Setup.md](Setup.md) for the full layout and the report generators in
[GenReport.md](GenReport.md).
