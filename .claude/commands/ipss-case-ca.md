Run a DC contingency analysis (CA / N-1 screening) for the current InterPSS simulation case — the case selected in the InterPSS tab — or for a named case, and report the overload summary.

Read and follow `.agents/skills/ipss-case-ca/SKILL.md` (canonical). That skill defines the tool call, how the contingency and monitored-branch inputs are resolved **without the CA dialog**, the configurable violation-check loading (`overloadThreshold`, 90 % by default) and the Java defaults, the contingency CSV columns and how to read them, the caveats (DC only, overwrites the CSV), and fallbacks for agents without the tool.

**Examples:**

```
/ipss-case-ca
/ipss-case-ca data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
/ipss-case-ca Texas 2K-bus with 2k_contingencies_115kVAbove.json
```
