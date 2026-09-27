Load a power-system simulation case into the embedded InterPSS bridge — the case selected in the InterPSS tab, or a named IEEE CDF / PSS/E RAW case — and report its active bus and branch counts. A request may also ask to reload the held case from disk and/or name a Groovy `.gvy` script to apply in the same step.

Read and follow `.agents/skills/ipss-case-load/SKILL.md` (canonical). That skill defines the tool call, the case-resolution order and the accepted `case` forms, what loading does to the held model (and what it replaces), how to read `source` / `alreadyLoaded` / the counts, when a re-parse is needed instead, how to load with a script (`interpss_run_gvy` with `reload: true` — `interpss_case_load` can neither re-parse nor run a script), and fallbacks for agents without the tool.

**Examples:**

```
/ipss-case-load
/ipss-case-load IEEE 118-bus
/ipss-case-load wspace/data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
/ipss-case-load reload
/ipss-case-load reload wspace/data/ieee/Ieee14BusLargeLoadQ2/scripts/ieee14_adjBus1314Q_0p89to0p90.gvy
```
