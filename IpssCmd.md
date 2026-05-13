## Activate Python Virtual Environment

Run commands from `wspace/` with the venv created at the **project root** (parent of `wspace/`). The simulation CLI is `src/ipss_cmd.py` at the project root; invoke it as `python ../src/ipss_cmd.py ...` after `cd wspace`. See [Setup.md](Setup.md) for full layout, JARs, and `config/config.json`.

```bash
cd wspace
source ../.venv/bin/activate
```

## Run Aclf (AC Loadflow)

For ACLF, `src/ipss_cmd.py` picks `aclf_run.json` in this order:

1. **Case-specific:** `wspace/<input_parent>/config/aclf_run.json` if it exists.
2. Otherwise **project default:** `config/aclf_run.json` at the project root.

It loads the file with `AclfRunConfigRec.loadAclfRunConfig` and applies it with `configAclfRun`. The line `Using config file: ...` on stderr shows which path was used. Adjust NR settings, limits, and related fields in that JSON without editing Python.

* Run ACLF for the IEEE CDF format

```
python ../src/ipss_cmd.py aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
```

* Run ACLF for the PSS/E RAW format

```
python ../src/ipss_cmd.py aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```

## Run Contingency Analysis

CA requires contingency and monitored-branches JSON paths (in addition to the case file). Example using the Texas 2K case files shipped under `wspace/data/psse/Texas2K/`:

```
python ../src/ipss_cmd.py ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

For another IEEE CDF case, supply your own `contingency.json` and `monitored.json` paths after the `.ieee` file, using `ca ieee ...`.