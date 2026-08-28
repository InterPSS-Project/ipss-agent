Run InterPSS AC load flow, DC contingency analysis, and NERC TPL-001-5 reporting for the provided case files.

Read and follow `.agents/skills/ipss-sim/SKILL.md` (canonical). That skill defines prerequisites, invocation syntax (directory / single-file / ACLF-only), the four workflow steps, result paths, and troubleshooting.

**Examples:**

```
/ipss-sim data/ieee/Ieee118Bus/ "IEEE 118-Bus Test Case"
/ipss-sim data/psse/Texas2K/ "Texas 2K-Bus System"
/ipss-sim Aclf only data/ieee/Ieee14Bus/ "IEEE 14-Bus Loadflow Report"
```
