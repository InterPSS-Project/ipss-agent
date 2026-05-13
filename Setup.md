# InterPSS Python Runtime — Setup Guide

This document describes how to set up and run the InterPSS Python runtime for power system simulations. 

## Project Overview

InterPSS is an open-source, Java-based power system simulation platform. This workspace bridges it to Python via [JPype](https://github.com/jpype-project/jpype), allowing you to run AC load flow and contingency analysis from Python scripts.

**Project layout** — the runtime is spread across a parent directory where `wspace/` is the working directory for scripts, data, and results, while `src/`, `lib/`, and `config/` are shared infrastructure at the parent level. The tree below uses `temp/` as a placeholder for that **project root** (in this repo, the `ipss.agent/` directory).

```
temp/
├── .agents/
│   └── skills/
│       └── ipss-sim/          # OpenAI Codex Desktop project skill
├── .claude/
│   ├── commands/
│   │   └── ipss-sim.md        # Claude Code slash-command entry point
│   └── skills/
│       └── ipss-sim/          # Claude Code skill copy
├── .venv/                     # Python virtual environment
├── requirements.txt           # Python dependencies (jpype1, numpy)
├── config/
│   ├── config.json            # JVM path, classpath, logging config (often gitignored locally)
│   └── aclf_run.json        # ACLF NR / limit-control settings (used by src/ipss_cmd.py)
├── lib/
│   ├── ipss_runnable.jar      # Main InterPSS runnable JAR
│   └── deps/                  # Third-party JARs (22 total)
│       ├── ipss.core.lib-1.0.16.jar
│       ├── ieee.odm.schema-1.0.1.jar
│       ├── ieee.odm_pss-1.0.1.jar
│       ├── slf4j-api-1.7.36.jar / slf4j-simple-1.7.36.jar
│       ├── org.eclipse.emf.common-2.28.0.jar / .ecore-2.38.0.jar
│       ├── hazelcast-5.3.6.jar
│       ├── jaxb-api-2.3.1.jar / jaxb-impl-2.3.1.jar
│       ├── javax.activation-api-1.2.0.jar
│       ├── commons-math3-3.6.1.jar
│       ├── JKLU-1.0.0.jar / BTFJ-1.0.1.jar / AMDJ-1.0.1.jar / COLAMDJ-1.0.1.jar
│       ├── csparsej-1.1.1.jar
│       ├── dflib-2.0.0-M6.jar / dflib-csv-2.0.0-M6.jar / dflib-json-2.0.0-M6.jar
│       ├── commons-csv-1.10.0.jar
│       └── gson-2.11.0.jar

├── src/
│   ├── __init__.py
│   ├── config.py              # ConfigManager + JvmManager
│   ├── interpss.py            # Java class imports namespace
│   ├── ipss_cmd.py            # CLI for running simulations
│   ├── adapter/
│       ├── __init__.py
│       └── input_adapter.py   # IeeeFileAdapter, PsseRawFileAdapter
│   └── report/                # Markdown report generators + shared helpers
│       ├── __init__.py
│       ├── ipss_report_common.py
│       ├── generate_aclf_report.py
│       └── generate_nerc_tpl_report.py
└── wspace/                    # <-- working directory
    ├── data/
    │   └── ieee/
    │       └── Ieee118Bus/
    │           └── ieee118.ieee   # IEEE 118-bus test case
```

JAR file names and versions under `lib/deps/` follow [`pom.xml`](pom.xml) and whatever `./mvnw dependency:copy-dependencies` resolves; the `lib/deps` fragment in the tree above is illustrative.

## Prerequisites

- **Python 3.10+** with pip
- **Java JDK 21** (or compatible version)
- **macOS / Linux / Windows**

Check your Java version:

```bash
java -version
```

The JVM shared library path is configured in `config/config.json`.

Common examples:

macOS:

```
/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/lib/libjli.dylib
```

Linux:

```
/usr/lib/jvm/java-21-openjdk/lib/server/libjvm.so
```

Windows:

```text
C:\Program Files\Eclipse Adoptium\jdk-21.0.6.7-hotspot\bin\server\jvm.dll
```

The exact Windows path depends on the JDK vendor and version. You can find it in
PowerShell with:

```powershell
Get-ChildItem -Path 'C:\Program Files\Java','C:\Program Files\Eclipse Adoptium' -Recurse -Filter jvm.dll -ErrorAction SilentlyContinue
```

## Step 1: Python Virtual Environment

From the **project root** (the directory that contains `wspace/`, `src/`, `config/`, and `lib/`), create and activate a Python virtual environment:

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

### Required Python Packages


| Package  | Version | Purpose                                  |
| -------- | ------- | ---------------------------------------- |
| `jpype1` | ≥ 1.5.0 | Java-Python bridge (see `requirements.txt`)                       |
| `numpy`  | ≥ 1.24  | Numerical operations used by `config.py` (see `requirements.txt`) |


## Step 2: JAR Dependencies

The InterPSS runtime requires these JAR categories:

### Recommended: Maven Setup

This repository includes a bash Maven wrapper (`mvnw`) and a version-controlled
`pom.xml` dependency manifest.

macOS / Linux:

```bash
./mvnw -q dependency:copy-dependencies
```

Windows PowerShell:

```powershell
.\mvnw.cmd -q dependency:copy-dependencies
```

The wrapper downloads the pinned Maven distribution on first use and copies the
runtime dependency JARs into `lib/deps/`. The downloaded Maven distribution and
copied JARs are local setup artifacts and are not committed.

Maintainers can regenerate the wrapper scripts from the project root:

```bash
mvn -N wrapper:wrapper -Dmaven=3.9.11
```

In PowerShell, quote the Maven version property:

```powershell
mvn -N wrapper:wrapper '-Dmaven=3.9.11'
```

### InterPSS Core JARs


| JAR                           | Source         | Purpose                            |
| ----------------------------- | -------------- | ---------------------------------- |
| `ipss_runnable.jar`           | InterPSS build | Plugin core, adapters, samples     |
| `ipss.core.lib-1.0.16.jar`    | InterPSS build | ACLF engine, algorithms, EMF model |
| `ipss.plugin.core-1.0.16.jar` | InterPSS build | Plugin framework                   |
| `ieee.odm.schema-1.0.1.jar`   | InterPSS build | IEEE ODM XML schema                |
| `ieee.odm_pss-1.0.1.jar`      | InterPSS build | IEEE ODM PSS types                 |


### Sparse Solver JARs


| JAR                  | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `JKLU-1.0.0.jar`     | KLU sparse LU solver                     |
| `BTFJ-1.0.1.jar`     | Block Triangular Form permutation        |
| `AMDJ-1.0.1.jar`     | Approximate Minimum Degree ordering      |
| `COLAMDJ-1.0.1.jar`  | Column AMD ordering                      |
| `csparsej-1.1.1.jar` | CSPARSEJ — CSparse sparse matrix library |


### DataFrame Export JARs (for CSV output)


| JAR                       | Maven Central Coordinates               | Purpose           |
| ------------------------- | --------------------------------------- | ----------------- |
| `dflib-2.0.0-M6.jar`      | `org.dflib:dflib:2.0.0-M6`              | DataFrame library |
| `dflib-csv-2.0.0-M6.jar`  | `org.dflib:dflib-csv:2.0.0-M6`          | CSV save support  |
| `dflib-json-2.0.0-M6.jar` | `org.dflib:dflib-json:2.0.0-M6`         | JSON support      |
| `commons-csv-1.10.0.jar`  | `org.apache.commons:commons-csv:1.10.0` | CSV parsing       |


> The Maven Central JARs can be downloaded from [Maven Central Repository](https://central.sonatype.com/) or any Maven mirror.

### Third-Party Support JARs


| JAR                                                       | Purpose                    |
| --------------------------------------------------------- | -------------------------- |
| `slf4j-api-1.7.36.jar` / `slf4j-simple-1.7.36.jar`        | Logging                    |
| `org.eclipse.emf.common-2.28.0.jar` / `.ecore-2.38.0.jar` | Eclipse Modeling Framework |
| `hazelcast-5.3.6.jar`                                     | Distributed computing      |
| `jaxb-api-2.3.1.jar` / `jaxb-impl-2.3.1.jar`              | XML binding                |
| `javax.activation-api-1.2.0.jar`                          | Java Activation Framework  |
| `commons-math3-3.6.1.jar`                                 | Math utilities             |


All JARs must be placed in `lib/` (main JARs) and `lib/deps/` (dependency JARs).

## Step 3: Configuration

The file `config/config.json` tells the runtime where to find the JVM and which JARs to load:

```json
{
  "jvm_path": "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/lib/libjli.dylib",
  "jar_path": "lib/ipss_runnable.jar:lib/deps",
  "log_config_path": "config/log4j2.xml"
}
```


| Key               | Description                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `jvm_path`        | Full path to the JVM shared library. Supports `{HOME}` expansion.                                                                     |
| `jar_path`        | Classpath entries separated by `:` (macOS/Linux) or `;` (Windows). Directories are expanded to include all `*.jar` files within them. |
| `log_config_path` | Optional path to a Log4j2 XML configuration file.                                                                                     |


The `ConfigManager` in `src/config.py` resolves relative paths against the project root (parent of `config/`).

Windows example:

```json
{
  "jvm_path": "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.6.7-hotspot\\bin\\server\\jvm.dll",
  "jar_path": "lib/ipss_runnable.jar;lib/deps",
  "log_config_path": "config/log4j2.xml"
}
```

`config/config.json` is intentionally ignored by git because the JVM path is
machine-specific.

### ACLF run configuration

`aclf_run.json` defines Newton–Raphson and related options (`maxIterations`, `tolerance`, `lfMethod`, PV/PQ limits, tap/shunt adjustments, and so on). For ACLF, `src/ipss_cmd.py` resolves the file with a **two-tier lookup**:

1. **Case-specific (preferred):** `<input_parent>/config/aclf_run.json` relative to `wspace/` (e.g. `data/psse/OpenEInterconnect/config/aclf_run.json` for input under that folder).
2. **Project default (fallback):** `config/aclf_run.json` at the project root.

The chosen path is loaded via `AclfRunConfigRec.loadAclfRunConfig` and applied with `configAclfRun(algo, polarCoordinate, includeAdjustments, False)`. The script prints `Using config file: <path>` to stderr so you can confirm which file ran. Edit the JSON to tune convergence or solver behavior without editing Python.

## Step 4: Running a Loadflow test

The main entry point is `src/ipss_cmd.py`. Run it from the `wspace/` directory with the virtual environment activated (paths below are relative to `wspace/`):

macOS / Linux:

```bash
cd wspace
source ../.venv/bin/activate
python ../src/ipss_cmd.py aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
```

Windows PowerShell:

```powershell
cd wspace
..\.venv\Scripts\Activate.ps1
python ..\src\ipss_cmd.py aclf ieee data\ieee\Ieee118Bus\ieee118.ieee
```

### Command Syntax

```
python ../src/ipss_cmd.py <simutype> <format> <input>
```


| Argument   | Values         | Description                                        |
| ---------- | -------------- | -------------------------------------------------- |
| `simutype` | `aclf`, `ca`   | Simulation type: load flow or contingency analysis |
| `format`   | `ieee`, `psse` | Input file format                                  |
| `input`    | path           | Input file path (relative to `wspace/`)            |


## Step 5: Generating NERC TPL-001-5 Reports

The report generator (`src/report/generate_nerc_tpl_report.py`) reads CSV outputs from a previous simulation run and produces a NERC TPL-001-5 compliance report in Markdown. The CSV prefix is auto-discovered from the result directory, so you provide a display name and the result directory name:

```bash
cd wspace
source ../.venv/bin/activate

# <display_name> is a human-readable name for the report header
# <result_dir> is the folder with CSVs: path relative to wspace/ (ACLF/CA CLI output), or a name under wspace/result/
python ../src/report/generate_nerc_tpl_report.py "IEEE 118-Bus Test Case" data/ieee/Ieee118Bus/result
python ../src/report/generate_nerc_tpl_report.py "Texas 2K-Bus System" data/psse/Texas2K/result
```

Windows PowerShell:

```powershell
cd wspace
..\.venv\Scripts\Activate.ps1
python ..\src\report\generate_nerc_tpl_report.py "IEEE 118-Bus Test Case" data\ieee\Ieee118Bus\result
```

The script writes `NERC_TPL_001_5_Report.md` into the same result directory. Alias-based discovery is also supported for single-argument backward compatibility:

```bash
python ../src/report/generate_nerc_tpl_report.py texas2k
python ../src/report/generate_nerc_tpl_report.py ieee118
```

Known aliases (`ieee` → `ieee118`, `texas` → `texas2k`) are defined in `KNOWN_CASE_ALIASES` at the top of `src/report/generate_nerc_tpl_report.py`.

### Generating AC Loadflow reports

For a focused AC load flow report (no NERC TPL contingency criteria, no `*_DF_contingency.csv` consumption), use `src/report/generate_aclf_report.py`. It reads the same `*_DF_{bus,branch,gen,load}.csv` plus `*_network_info.txt` that `../src/ipss_cmd.py aclf` produces and writes `AC_Loadflow_Report.md` into the same result directory:

```bash
cd wspace
source ../.venv/bin/activate
python ../src/ipss_cmd.py aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
python ../src/report/generate_aclf_report.py "IEEE 118-Bus Test Case" data/ieee/Ieee118Bus/result
```

The script shares analysis and Markdown helpers with the NERC generator through `src/report/ipss_report_common.py`, so voltage bands, thermal loading percentages, and generator Q-limit logic stay aligned between the two reports.

## Step 6: Verifying the `ipss-sim` Agent Skill

This repository already includes agent-facing skill files so Codex and Claude can run the full simulation workflow from a natural-language prompt. No copy step is required when the repository is opened as a project; setup means verifying the files are present and then invoking the skill from the supported agent.

### OpenAI Codex Desktop

The Codex project skill is stored at:

```text
.agents/skills/ipss-sim/SKILL.md
```

UI metadata for the skill is stored at:

```text
.agents/skills/ipss-sim/agents/openai.yaml
```

To use it:

1. Add or open this repository folder as a Codex Desktop project.
2. Make sure Steps 1-3 above have been completed.
3. Verify the files below are present.
4. Invoke the skill by name in a prompt:

```text
Use $ipss-sim to run data/ieee/Ieee118Bus/ieee118.ieee "IEEE 118-Bus Test Case"
```

For a directory that contains a case file plus contingency and monitored-branch JSON files:

```text
Use $ipss-sim to run data/psse/Texas2K "Texas 2K-Bus System"
```

Codex should load the project skill from `.agents/skills/ipss-sim/` and then run the workflow from `wspace/`:

1. ACLF with `python ../src/ipss_cmd.py aclf ...`
2. CA with `python ../src/ipss_cmd.py ca ...` when contingency and monitored files are provided or auto-discovered
3. Report generation with `python ../src/report/generate_nerc_tpl_report.py ...`

### Claude Code CLI

Claude skill and command registration files are stored at:

```text
.claude/skills/ipss-sim/SKILL.md
.claude/commands/ipss-sim.md
```

Use the slash-command form:

```text
/ipss-sim data/ieee/Ieee118Bus/ieee118.ieee "IEEE 118-Bus Test Case"
```

or directory mode:

```text
/ipss-sim data/psse/Texas2K "Texas 2K-Bus System"
```

### Version-Control Notes

- `.agents/skills/ipss-sim/**`, `.claude/skills/ipss-sim/**`, and `.claude/commands/ipss-sim.md` should be committed.
- `.venv/`, `config/config.json`, generated `lib/deps/*.jar`, `.mvn/wrapper/dists/`, and `wspace/**/result/` are local setup or output artifacts and should remain uncommitted.
- If the skill instructions change, edit `.agents/skills/ipss-sim/SKILL.md` first, then run `./scripts/sync_ipss_skills.sh` from the project root to copy it to `.claude/skills/ipss-sim/SKILL.md` (or copy the file manually on Windows).

### Quick Verification

From the project root, these commands should show the registered skill files:

macOS / Linux:

```bash
find .agents/skills/ipss-sim .claude/skills/ipss-sim .claude/commands -maxdepth 3 -type f | sort
```

Windows PowerShell:

```powershell
Get-ChildItem .agents\skills\ipss-sim, .claude\skills\ipss-sim, .claude\commands -Recurse -File |
  ForEach-Object { Resolve-Path -Relative $_.FullName }
```

Expected entries include:

```text
.agents/skills/ipss-sim/SKILL.md
.agents/skills/ipss-sim/agents/openai.yaml
.claude/commands/ipss-sim.md
.claude/skills/ipss-sim/SKILL.md
```

