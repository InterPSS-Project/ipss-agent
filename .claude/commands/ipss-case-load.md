Load a power-system simulation case into the embedded InterPSS bridge — the case selected in the InterPSS tab, or a named IEEE CDF / PSS/E RAW case — and report its active bus and branch counts.

Read and follow `.agents/skills/ipss-case-load/SKILL.md` (canonical). That skill defines the tool call, the case-resolution order and the accepted `case` forms, what loading does to the held model (and what it replaces), how to read `source` / `alreadyLoaded` / the counts, when a re-parse is needed instead, and fallbacks for agents without the tool.

**Examples:**

```
/ipss-case-load
/ipss-case-load IEEE 118-bus
/ipss-case-load wspace/data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```
