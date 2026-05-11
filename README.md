# ipss.agent

**InterPSS Agent** for AC load flow, DC-based contingency analysis, and NERC TPL-001-5 style reporting. This repo is set up for Agentic power system simulation automation in **Cursor**, **Claude Code**, **Gemini**and **OpenAI Codex** (skills/commands).

## Quick setup

From the **repository root** folder:

**OpenAI Codex (Recommended)** 
Add this folder as a Codex project, setp the **ipss-sim** skill/command, :

```text
    Setup ipss.agent environment
    # test the setup by running the sample case in the wspace/data folder
    /ipss-sim <simu_case_directory> "<NERC Report Name>" 
```

Then you can add your data forlder to as a project to the Codex, and ask the agent to run the power system simulation workflow.

**CLI Setup**

```text
    /init  # optional init step
    Setup ipss.agent env
    Setup the Skills and command to run the workflow #
```

## Perform Simulation and Generate Report

**Skill-style Simulation**

```text
    /ipss-sim <simu_case_file> in psse format, <contingency_file> <monitored_file> "<NERC Report Name>"
```

or directory mode (auto-discovers `*.RAW` / `*.raw` / `*.ieee`, `*contingency*.json`, `*monitor*.json`):

```text
    /ipss-sim <simu_case_directory> "<NERC Report Name>"
```

**Direct Prompt Simulation**

```text
    Run ACLF format psse <case_file>
    Run CA format psse <case_file> <contingency_file> <monitor_file>
    Gen NERC TPL report <case_name> <result_dir>
```

## Explore Simulation Results

The simulation results are stored in the `<case_directory>/result` folder. You can explore the results with the LLM:

```text
    # Loadflow results
    Find the lowest voltage bus
    Find the highest loading branch
    # Contingency analysis results
    Find the top N-1 loaded branches
```

## Reference


| Topic                            | Document                     |
| -------------------------------- | ---------------------------- |
| Layout, JARs, `config.json`, JVM | [Setup.md](Setup.md)         |
| `ipss_cmd.py` usage              | [IpssCmd.md](IpssCmd.md)     |
| Report generator                 | [GenReport.md](GenReport.md) |


