# iPSS Agent

**[InterPSS Agentic Power System Simulation Agent](https://bit.ly/49L3joo)** for AC load flow, DC-based contingency analysis, and NERC TPL-001-5 style reporting. This repository ships agent-facing skills for **OpenAI Codex Desktop** and **Claude Code CLI** (see [Setup.md](Setup.md)). Other agent CLIs can reuse the same workflow by copying the skill content from `.agents/skills/ipss-sim/` or `.claude/skills/ipss-sim/`.

## Environment setup

Git check out or download this repository and follow the setup instructions below.

### OpenAI Codex Desktop (recommended)

1. Add the folder as a Codex project.
2. Run the setup below, then test with a sample case (for example, under `wspace/data/psse/Texas2K`).

```text
Setup ipss.agent env
# Test the setup with a sample case directory
/ipss-sim <simu_case_directory> "<NERC Report Name>"
```

After completing the env setup, add your data folder as a Codex project and use the agent to do the simulations.

**Data Security**: If you are concenred about your simulation data security, you can run your Codex with a local Ollama LLM. Use a latest LLM model, such as Qwen3.6, is recommended. Also, use a machine with 32GB or more memory to run Codex with the local LLM setup.

### Claude Code CLI setup

```text
/init  # optional
Setup ipss.agent env
Setup the skills and commands to run the workflow
```

## Run simulations and generate reports

After the setup, run power-system simulations through the agent.

### Skill-style simulation

Input file mode:

```text
/ipss-sim <simu_case_file> <contingency_file> <monitored_file> "<NERC Report Name>"
```

Input directory mode (auto-discovers `*.RAW` / `*.raw` / `*.ieee`, `*contingency*.json`, `*monitor*.json`):

```text
/ipss-sim <simu_case_directory> "<NERC Report Name>"
/ipss-sim Aclf only <simu_case_directory> "<Loadflow Report Name>"

/NERC Report HTML         # generate Html report
/NERC Report Slides       # generate PPT report
```

### Direct prompt simulation

```text
Run ACLF format psse <case_file>
Run CA format psse <case_file> <contingency_file> <monitor_file>
Gen NERC TPL report "<NERC Report Name>" <result_dir>
```

## Explore simulation results

Results are written under `wspace/<parent_of_case_file>/result/` (the directory that contains your case file, plus a `result` subfolder). You can inspect them with the LLM, for example:

```text
# Load flow
Find the lowest voltage bus
Find the highest loading branch
# Contingency analysis
Find the top N-1 loaded branches
```

## Reference


| Topic                            | Document                     |
| -------------------------------- | ---------------------------- |
| Layout, JARs, `config.json`, JVM | [Setup.md](Setup.md)         |
| `src/ipss_cmd.py` usage          | [IpssCmd.md](IpssCmd.md)     |
| Report generator                 | [GenReport.md](GenReport.md) |


