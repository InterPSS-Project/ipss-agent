package org.interpss.agent.report;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.interpss.agent.util.ProjectPaths;

/**
 * NERC TPL-001-5 compliance assessment report generator (Markdown).
 * NERC TPL-001-5 compliance assessment report generator (Markdown).
 */
public final class NercTplReportGenerator {

    private static final DateTimeFormatter REPORT_DATE_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String GENERATED_BY =
            "`org.interpss.agent.report.NercTplReportGenerator`";

    public record ReportResult(
            String markdown,
            Path caseBase,
            String prefix,
            String displayName,
            String sourceDesc) {
    }

    private NercTplReportGenerator() {
    }

    public static ReportResult generate(
            ProjectPaths paths,
            ReportConfig cfg,
            String caseName,
            String resultDir,
            Clock clock) throws IOException {
        Path caseBase;
        String prefix;
        String displayName;
        String sourceDesc;

        if (resultDir != null && !resultDir.isBlank()) {
            caseBase = ReportCaseResolver.resolveCaseBase(paths, resultDir);
            prefix = ReportCaseResolver.resolvePrefix(caseBase, null);
            displayName = caseName;
            sourceDesc = ReportCaseResolver.sourceDescription(paths, caseBase);
        } else {
            ReportCaseResolver.LegacyCaseConfig legacy =
                    ReportCaseResolver.getLegacyCase(paths, caseName);
            caseBase = paths.wspaceDir().resolve("result").resolve(legacy.dir());
            prefix = legacy.prefix();
            displayName = legacy.name();
            sourceDesc = legacy.source();
        }

        List<Map<String, String>> buses =
                CsvDataLoader.loadRequired(caseBase, prefix + "_DF_bus.csv");
        List<Map<String, String>> branches =
                CsvDataLoader.loadRequired(caseBase, prefix + "_DF_branch.csv");
        List<Map<String, String>> gens =
                CsvDataLoader.loadRequired(caseBase, prefix + "_DF_gen.csv");
        List<Map<String, String>> loads =
                CsvDataLoader.loadRequired(caseBase, prefix + "_DF_load.csv");
        List<Map<String, String>> contingencyRaw =
                CsvDataLoader.loadOptional(caseBase, prefix + "_DF_contingency.csv");
        NetworkInfoParser.NetworkInfo networkInfo =
                NetworkInfoParser.parse(caseBase, prefix);

        VoltageAnalyzer.VoltageProfileResult voltage =
                VoltageAnalyzer.analyze(buses, cfg);
        BranchLoadingAnalyzer.BranchLoadingResult branchLoad =
                BranchLoadingAnalyzer.analyze(branches, cfg);
        GeneratorQAnalyzer.GeneratorQResult genQ =
                GeneratorQAnalyzer.analyze(gens, cfg);
        ContingencyAnalyzer.ContingencyCandidates contingency =
                ContingencyAnalyzer.analyzeCandidates(branches, gens, cfg);
        Map<List<String>, List<String>> parallel =
                ContingencyAnalyzer.identifyParallelCircuits(branches);
        ContingencyAnalyzer.ContingencyResults contingencyResults =
                ContingencyAnalyzer.analyzeResults(contingencyRaw, cfg);

        double totalGenP = sumField(gens, "PGen");
        double totalGenQ = sumField(gens, "QGen");
        double totalLoadP = sumField(loads, "PLoadTotal");
        double totalLoadQ = sumField(loads, "QLoadTotal");
        double lossesP = totalGenP - totalLoadP;
        double lossesQ = totalGenQ - totalLoadQ;

        List<Map<String, String>> pvBuses = buses.stream()
                .filter(b -> "PV".equals(b.get("BusType"))).toList();
        List<Map<String, String>> pqBuses = buses.stream()
                .filter(b -> "PQ".equals(b.get("BusType"))).toList();
        List<Map<String, String>> swingBuses = buses.stream()
                .filter(b -> "Swing".equals(b.get("BusType"))).toList();

        String swingBusNum = swingBuses.isEmpty() ? null : swingBuses.get(0).get("Number");
        String swingBusName = swingBuses.isEmpty()
                ? "Unknown"
                : BusAnalysisUtil.strip(swingBuses.get(0), "Name");
        double swingVsched = swingBusNum == null ? 0 : findGenDouble(gens, swingBusNum, "VSched");
        double swingP = swingBusNum == null ? 0 : findGenDouble(gens, swingBusNum, "PGen");
        double swingQ = swingBusNum == null ? 0 : findGenDouble(gens, swingBusNum, "QGen");

        String markdown = buildMarkdown(
                paths, cfg, clock, caseName, displayName, sourceDesc, caseBase, prefix,
                buses, branches, gens, loads, networkInfo,
                voltage, branchLoad, genQ, contingency, parallel, contingencyResults,
                totalGenP, totalGenQ, totalLoadP, totalLoadQ, lossesP, lossesQ,
                pvBuses, pqBuses, swingBuses, swingBusNum, swingBusName,
                swingVsched, swingP, swingQ);

        return new ReportResult(markdown, caseBase, prefix, displayName, sourceDesc);
    }

    @SuppressWarnings("unchecked")
    private static String buildMarkdown(
            ProjectPaths paths,
            ReportConfig cfg,
            Clock clock,
            String caseName,
            String displayName,
            String sourceDesc,
            Path caseBase,
            String prefix,
            List<Map<String, String>> buses,
            List<Map<String, String>> branches,
            List<Map<String, String>> gens,
            List<Map<String, String>> loads,
            NetworkInfoParser.NetworkInfo networkInfo,
            VoltageAnalyzer.VoltageProfileResult voltage,
            BranchLoadingAnalyzer.BranchLoadingResult branchLoad,
            GeneratorQAnalyzer.GeneratorQResult genQ,
            ContingencyAnalyzer.ContingencyCandidates contingency,
            Map<List<String>, List<String>> parallel,
            ContingencyAnalyzer.ContingencyResults contingencyResults,
            double totalGenP,
            double totalGenQ,
            double totalLoadP,
            double totalLoadQ,
            double lossesP,
            double lossesQ,
            List<Map<String, String>> pvBuses,
            List<Map<String, String>> pqBuses,
            List<Map<String, String>> swingBuses,
            String swingBusNum,
            String swingBusName,
            double swingVsched,
            double swingP,
            double swingQ) {
        List<String> report = new ArrayList<>();

        Map<String, Object> voltageSection = cfg.section("voltage");
        Map<String, Object> p0Cfg = (Map<String, Object>) voltageSection.get("p0");
        Map<String, Object> p1p7Cfg = (Map<String, Object>) voltageSection.get("p1_p7");
        Map<String, Object> bandsCfg = (Map<String, Object>) voltageSection.get("bands");

        double p0VMin = number(p0Cfg.get("v_min"), 0.95);
        double p0VMax = number(p0Cfg.get("v_max"), 1.05);
        double p0VMargLow = number(p0Cfg.get("v_marginal_low"), 0.98);
        double p1VMin = number(p1p7Cfg.get("v_min"), 0.90);
        double p1VMax = number(p1p7Cfg.get("v_max"), 1.05);

        double overloadPct = cfg.dbl("thermal", "overload_pct", 100);
        double heavyPct = cfg.dbl("thermal", "heavy_pct", 80);
        double moderatePct = cfg.dbl("thermal", "moderate_pct", 50);
        double severePct = cfg.dbl("thermal", "severe_pct", 120);
        double qAtLimitMargin = cfg.dbl("generator", "q_at_limit_margin", 0.015);
        int maxHeavilyLoaded = cfg.displayInt("max_heavily_loaded", 10);
        int maxModerateLoaded = cfg.displayInt("max_moderate_loaded", 10);
        int maxQLimit = cfg.displayInt("max_q_limit", 20);
        int maxContingencyOverloads = cfg.displayInt("max_contingency_overloads", 20);
        int marginalSampleCount = cfg.displayInt("marginal_sample_count", 10);

        double baseMva = cfg.baseMva();
        int baseKva = cfg.baseKva();

        boolean p0VoltageOk = voltage.passed();
        boolean p0ThermalOk = branchLoad.hasRatings() && branchLoad.overloaded().isEmpty();
        boolean p0ThermalInconclusive = !branchLoad.hasRatings();
        boolean qPass = genQ.violations().isEmpty();

        String p0Status;
        String p0Description;
        if (!p0VoltageOk) {
            p0Status = "**NON-COMPLIANT**";
            p0Description = "voltage violations";
        } else if (p0ThermalInconclusive) {
            p0Status = "INCONCLUSIVE";
            p0Description = "Thermal ratings missing";
        } else if (!p0ThermalOk) {
            p0Status = "**NON-COMPLIANT**";
            p0Description = "thermal overloads";
        } else if (!qPass) {
            p0Status = "**NON-COMPLIANT**";
            p0Description = "generator Q-limit violations";
        } else {
            p0Status = "COMPLIANT";
            p0Description = "All P0 criteria met";
        }

        boolean p0OverallPass = p0VoltageOk && p0ThermalOk && qPass && !p0ThermalInconclusive;
        boolean ratingsUnavailable = !branchLoad.hasRatings();

        String reportDate = LocalDateTime.now(clock.withZone(ZoneId.systemDefault()))
                .format(REPORT_DATE_FMT);

        // Title and Header
        w(report, "# NERC TPL-001-5 Transmission System Planning Performance");
        w(report, "## Compliance Assessment Report");
        w(report, "");
        w(report, "**" + displayName + "**");
        w(report, "");
        w(report, "---");
        w(report, "");
        w(report, MarkdownTable.row("Field", "Value"));
        w(report, MarkdownTable.separator(2));
        w(report, MarkdownTable.row("**System**", displayName));
        w(report, MarkdownTable.row("**Base MVA**", ReportFormat.fmt0(baseMva) + " MVA"));
        w(report, MarkdownTable.row("**Report Date**", reportDate));
        w(report, MarkdownTable.row("**Input**", sourceDesc));
        w(report, MarkdownTable.row("**P0 Status**", p0Status));
        w(report, "");

        // AclfNetwork Summary
        if (networkInfo != null) {
            w(report, "## AclfNetwork Summary");
            w(report, "");
            Map<String, String> aclf = networkInfo.aclfNetwork();
            Map<String, String> lf = networkInfo.loadflowRun();
            w(report, MarkdownTable.row("Parameter", "Value"));
            w(report, MarkdownTable.separator(2));
            for (Map.Entry<String, String> entry : aclf.entrySet()) {
                w(report, MarkdownTable.row(entry.getKey(), entry.getValue()));
            }
            if (lf != null && !lf.isEmpty()) {
                w(report, MarkdownTable.row("Loadflow Converged",
                        lf.getOrDefault("Loadflow converged", "N/A")));
                w(report, MarkdownTable.row("Max Mismatch",
                        lf.getOrDefault("Max mismatch", "N/A")));
            }
            w(report, "");
        }

        // NERC TPL-001-5 Performance Criteria Overview
        w(report, "## NERC TPL-001-5 Performance Criteria Overview");
        w(report, "");
        w(report, "The NERC TPL-001-5 standard defines seven planning event categories with corresponding steady-state performance requirements.");
        w(report, "");
        String p0VStr = ReportFormat.fmt2(p0VMin) + "–" + ReportFormat.fmt2(p0VMax) + " pu";
        String p1VStr = ReportFormat.fmt2(p1VMin) + "–" + ReportFormat.fmt2(p1VMax) + " pu";
        w(report, MarkdownTable.row("Category", "Initial Condition", "Contingency", "Element Loss",
                "Voltage", "Thermal", "Stability"));
        w(report, MarkdownTable.separator(7));
        w(report, MarkdownTable.row("**P0**", "All in Svc", "None", "None", p0VStr, "≤100% Rate A", "Stable"));
        w(report, MarkdownTable.row("**P1**", "All in Svc", "1 gen, trans, line, shunt", "N-1", p1VStr,
                "≤100% Rate A", "Stable"));
        w(report, MarkdownTable.row("**P2**", "All in Svc", "1 bus section, breaker", "N-1", p1VStr,
                "≤100% Rate A", "Stable"));
        w(report, MarkdownTable.row("**P3**", "All in Svc", "Common ROW", "N-2", p1VStr,
                "≤100% Rate B", "Stable"));
        w(report, MarkdownTable.row("**P4**", "All in Svc", "Breaker failure (bus-tie)", "N-2", p1VStr,
                "≤100% Rate B", "Stable"));
        w(report, MarkdownTable.row("**P5**", "All in Svc", "Relay failure (delayed fault)", "N-2", p1VStr,
                "≤100% Rate B", "Stable"));
        w(report, MarkdownTable.row("**P6**", "All in Svc", "N-1-1 (manual adj. between)", "N-1 + N-1", p1VStr,
                "≤100% Rate B", "May shed load"));
        w(report, MarkdownTable.row("**P7**", "All in Svc", "Common ROW + delayed fault", "N-2+",
                "Evaluate risk", "Evaluate risk", "May interrupt svc"));
        w(report, "");

        // Executive Summary
        w(report, "## Executive Summary");
        w(report, "");
        if (p0OverallPass) {
            w(report, "### P0 (Base Case) Assessment: **PASS** — COMPLIANT");
        } else if (!p0VoltageOk || !p0ThermalOk || !qPass) {
            w(report, "### P0 (Base Case) Assessment: **FAIL** — NON-COMPLIANT (" + p0Description + ")");
        } else if (p0ThermalInconclusive) {
            w(report, "### P0 (Base Case) Assessment: INCONCLUSIVE");
        } else {
            w(report, "### P0 (Base Case) Assessment: **FAIL** — NON-COMPLIANT (" + p0Description + ")");
        }
        w(report, "");
        w(report, MarkdownTable.row("Metric", "Value"));
        w(report, MarkdownTable.separator(2));
        w(report, MarkdownTable.row("Total Buses",
                buses.size() + " (" + pqBuses.size() + " PQ, " + pvBuses.size() + " PV, "
                        + swingBuses.size() + " Swing)"));
        w(report, MarkdownTable.row("Total Branches",
                branches.size() + " (" + branchLoad.branchesWithRatings() + " with MVA ratings)"));
        w(report, MarkdownTable.row("Total Generators", genQ.totalGens()));
        w(report, MarkdownTable.row("Total Load",
                ReportFormat.fmt2(totalLoadP) + " pu P / " + ReportFormat.fmt2(totalLoadQ) + " pu Q"));
        w(report, MarkdownTable.row("Total Generation",
                ReportFormat.fmt2(totalGenP) + " pu P / " + ReportFormat.fmt2(totalGenQ) + " pu Q"));
        w(report, MarkdownTable.row("System Losses",
                ReportFormat.fmt2(lossesP) + " pu P / " + ReportFormat.fmt2(lossesQ) + " pu Q"));
        if (swingBusNum != null) {
            w(report, MarkdownTable.row("Swing Bus",
                    "Bus" + swingBusNum + " (" + swingBusName + ") at "
                            + ReportFormat.fmt4(swingVsched) + " pu"));
            w(report, MarkdownTable.row("Swing Output",
                    ReportFormat.fmt2(swingP) + " pu P / " + ReportFormat.fmt2(swingQ) + " pu Q"));
        }
        w(report, "");

        w(report, "### Compliance Summary");
        w(report, "");
        w(report, MarkdownTable.row("Assessment Area", "Result", "Status"));
        w(report, MarkdownTable.separator(3));

        String vStatus = MarkdownTable.statusBadge(voltage.passed());
        int nActive = voltage.busesAnalyzed();

        String tResult;
        String tStatus;
        if (!branchLoad.hasRatings()) {
            tResult = "Branch MVA ratings not populated (" + branchLoad.totalBranches() + " branches)";
            tStatus = "INCONCLUSIVE";
        } else {
            List<BranchLoadingAnalyzer.BranchFlow> overloadsP0 = branchLoad.overloaded();
            tResult = overloadsP0.isEmpty()
                    ? "No overloads"
                    : overloadsP0.size() + " overloaded circuits";
            tStatus = MarkdownTable.statusBadge(overloadsP0.isEmpty());
        }

        int vLowCount = voltage.violationsLow().size();
        int vHighCount = voltage.violationsHigh().size();
        int vMargCount = voltage.lowVoltageWarn().size();
        double vLowPct = nActive > 0 ? vLowCount / (double) nActive * 100 : 0;
        double vHighPct = nActive > 0 ? vHighCount / (double) nActive * 100 : 0;
        double vMargPct = nActive > 0 ? vMargCount / (double) nActive * 100 : 0;

        List<String> vParts = new ArrayList<>();
        if (vLowCount > 0) {
            vParts.add(vLowCount + " buses < " + ReportFormat.fmt2(p0VMin) + " pu ("
                    + ReportFormat.pct1(vLowPct) + ")");
        }
        if (vHighCount > 0) {
            vParts.add(vHighCount + " buses > " + ReportFormat.fmt2(p0VMax) + " pu ("
                    + ReportFormat.pct1(vHighPct) + ")");
        }
        vParts.add(vMargCount + " marginal (" + ReportFormat.pct1(vMargPct) + ")");
        String vResult = vParts.isEmpty() ? "All buses within limits" : String.join("; ", vParts);

        w(report, MarkdownTable.row("**Voltage Profile**", vResult, vStatus));
        w(report, MarkdownTable.row("**Thermal Loading**", tResult, tStatus));

        int qAtLimit = genQ.atLimit().size();
        int qViolations = genQ.violations().size();
        int nGens = genQ.totalGens();
        double qLimitPct = nGens > 0 ? qAtLimit / (double) nGens * 100 : 0;
        double qViolPct = nGens > 0 ? qViolations / (double) nGens * 100 : 0;
        w(report, MarkdownTable.row("**Generator Q-Limits**",
                qAtLimit + " at limit (" + ReportFormat.pct1(qLimitPct)
                        + "), " + qViolations + " violations ("
                        + ReportFormat.pct1(qViolPct) + ")",
                MarkdownTable.statusBadge(qPass)));

        if (contingencyResults != null) {
            w(report, MarkdownTable.row("**P1 Contingency Thermal**",
                    contingencyResults.totalOverloads() + " post-contingency overloads from "
                            + contingencyResults.totalContingencies() + " N-1 contingencies",
                    MarkdownTable.statusBadge(contingencyResults.p1ThermalPass())));
        }

        if (p0OverallPass) {
            w(report, MarkdownTable.row("**P0 OVERALL**", "All criteria met", "**COMPLIANT**"));
        } else if (p0ThermalInconclusive) {
            w(report, MarkdownTable.row("**P0 OVERALL**", p0Description, "**INCONCLUSIVE**"));
        } else {
            w(report, MarkdownTable.row("**P0 OVERALL**", p0Description, "**NON-COMPLIANT**"));
        }
        w(report, "");

        w(report, "> **Note:** Summary P/Q values are reported in per-unit on a "
                + ReportFormat.fmt0(baseMva) + " MVA base unless otherwise noted.");
        w(report, "");

        // Section 1: P0
        w(report, "## Section 1: P0 — Normal System (Base Case)");
        w(report, "");
        w(report, "**Category P0** requires all transmission elements in service with no contingencies.");
        w(report, "Steady-state performance criteria:");
        w(report, "");
        w(report, "- Bus voltages must remain within **"
                + ReportFormat.fmt2(p0VMin) + "–" + ReportFormat.fmt2(p0VMax) + " pu**");
        w(report, "- Branch thermal loading must not exceed **100% of Rate A**");
        w(report, "- System must remain **stable**");
        w(report, "");

        // 1.1 Voltage Profile
        w(report, "### 1.1 Steady-State Voltage Profile");
        w(report, "");
        w(report, "#### Voltage Extremes");
        w(report, "");
        w(report, MarkdownTable.row("Metric", "Value", "Location"));
        w(report, MarkdownTable.separator(3));
        w(report, MarkdownTable.row("Minimum Voltage",
                "**" + ReportFormat.fmt4(voltage.vMin()) + " pu**", voltage.vMinBus()));
        w(report, MarkdownTable.row("Maximum Voltage",
                "**" + ReportFormat.fmt4(voltage.vMax()) + " pu**", voltage.vMaxBus()));
        w(report, "");

        Map<String, List<VoltageAnalyzer.Violation>> bands = voltage.bands();
        if (bands != null && !bands.isEmpty()) {
            w(report, "#### Voltage Band Distribution");
            w(report, "");
            w(report, MarkdownTable.row("Voltage Range", "Description", "Buses", "% of In-Service"));
            w(report, MarkdownTable.separator(4));

            double severeLow = number(bandsCfg.get("severe_low"), 0.90);
            double violationLow = number(bandsCfg.get("violation_low"), p0VMin);
            double marginalLow = number(bandsCfg.get("marginal_low"), p0VMargLow);
            double marginalHigh = number(bandsCfg.get("marginal_high"), 1.02);
            double violationHigh = number(bandsCfg.get("violation_high"), p0VMax);

            Map<String, String> bandDescriptions = Map.of(
                    "severe_low", "< " + ReportFormat.fmt2(severeLow) + " pu",
                    "violation_low", ReportFormat.fmt2(severeLow) + "–"
                            + ReportFormat.fmt2(violationLow) + " pu",
                    "marginal", ReportFormat.fmt2(violationLow) + "–"
                            + ReportFormat.fmt2(marginalLow) + " pu",
                    "nominal", ReportFormat.fmt2(marginalLow) + "–"
                            + ReportFormat.fmt2(marginalHigh) + " pu",
                    "high_ok", ReportFormat.fmt2(marginalHigh) + "–"
                            + ReportFormat.fmt2(violationHigh) + " pu",
                    "violation_high", "> " + ReportFormat.fmt2(violationHigh) + " pu");
            Map<String, String> bandLabels = Map.of(
                    "severe_low", "Severe Low (NON-COMPLIANT)",
                    "violation_low", "Low Violation (NON-COMPLIANT)",
                    "marginal", "Marginal Low (OK)",
                    "nominal", "Nominal",
                    "high_ok", "High Acceptable (OK)",
                    "violation_high", "High Violation (NON-COMPLIANT)");

            for (String bandKey : List.of("severe_low", "violation_low", "marginal", "nominal",
                    "high_ok", "violation_high")) {
                int count = bands.getOrDefault(bandKey, List.of()).size();
                double pct = nActive > 0 ? count / (double) nActive * 100 : 0;
                if (count > 0 || "marginal".equals(bandKey) || "nominal".equals(bandKey)) {
                    w(report, MarkdownTable.row(
                            bandDescriptions.getOrDefault(bandKey, ""),
                            bandLabels.getOrDefault(bandKey, bandKey),
                            String.valueOf(count),
                            ReportFormat.pct1(pct)));
                }
            }
            w(report, "");
        }

        if (voltage.inactiveExcluded() > 0) {
            w(report, "> **Note:** P0 voltage statistics use **in-service buses only** (`InService` in the bus CSV). "
                    + "**" + voltage.inactiveExcluded() + "** out-of-service buses were excluded "
                    + "(they often show **0.0 pu** and are outside the solved network).");
            w(report, "");
        }

        if (!voltage.violationsLow().isEmpty()) {
            w(report, "#### Voltage Violations (Below " + ReportFormat.fmt2(p0VMin)
                    + " pu) — " + voltage.violationsLow().size() + " Buses");
            w(report, "");
            w(report, MarkdownTable.row("Bus", "Name", "Voltage (pu)"));
            w(report, MarkdownTable.separator(3));
            for (VoltageAnalyzer.Violation v : voltage.violationsLow()) {
                w(report, MarkdownTable.row("Bus" + v.busId(), v.name(),
                        "**" + ReportFormat.fmt4(v.voltage()) + "**"));
            }
            w(report, "");
        }

        if (!voltage.violationsHigh().isEmpty()) {
            w(report, "#### Voltage Violations (Above " + ReportFormat.fmt2(p0VMax)
                    + " pu) — " + voltage.violationsHigh().size() + " Buses");
            w(report, "");
            w(report, MarkdownTable.row("Bus", "Name", "Voltage (pu)"));
            w(report, MarkdownTable.separator(3));
            for (VoltageAnalyzer.Violation v : voltage.violationsHigh()) {
                w(report, MarkdownTable.row("Bus" + v.busId(), v.name(),
                        ReportFormat.fmt4(v.voltage())));
            }
            w(report, "");
        }

        if (!voltage.lowVoltageWarn().isEmpty()) {
            List<VoltageAnalyzer.Violation> warn = voltage.lowVoltageWarn();
            int nWarn = warn.size();
            w(report, "#### Marginal Low Voltage (" + ReportFormat.fmt2(p0VMin) + "–"
                    + ReportFormat.fmt2(p0VMargLow) + " pu) — " + nWarn + " Buses");
            w(report, "");
            List<Double> vals = warn.stream().map(VoltageAnalyzer.Violation::voltage).sorted().toList();
            double vMinM = vals.get(0);
            double vMaxM = vals.get(vals.size() - 1);
            double vMean = vals.stream().mapToDouble(Double::doubleValue).sum() / nWarn;
            double vMed;
            int mid = nWarn / 2;
            if (nWarn % 2 != 0) {
                vMed = vals.get(mid);
            } else {
                vMed = (vals.get(mid - 1) + vals.get(mid)) / 2;
            }
            w(report, "These buses are within the P0 **" + ReportFormat.fmt2(p0VMin) + "–"
                    + ReportFormat.fmt2(p0VMax) + " pu** band but below **"
                    + ReportFormat.fmt2(p0VMargLow) + " pu**. "
                    + "Per-bus listing is omitted for large cases.");
            w(report, "");
            w(report, MarkdownTable.row("Metric", "Value"));
            w(report, MarkdownTable.separator(2));
            w(report, MarkdownTable.row("Buses in band", String.valueOf(nWarn)));
            w(report, MarkdownTable.row("Minimum V", ReportFormat.fmt4(vMinM) + " pu"));
            w(report, MarkdownTable.row("Median V", ReportFormat.fmt4(vMed) + " pu"));
            w(report, MarkdownTable.row("Mean V", ReportFormat.fmt4(vMean) + " pu"));
            w(report, MarkdownTable.row("Maximum V", ReportFormat.fmt4(vMaxM) + " pu"));
            w(report, "");
            w(report, "**Lowest " + marginalSampleCount + " buses by voltage (sample):**");
            w(report, "");
            w(report, MarkdownTable.row("Bus", "Name", "V (pu)"));
            w(report, MarkdownTable.separator(3));
            warn.stream()
                    .sorted(Comparator.comparingDouble(VoltageAnalyzer.Violation::voltage))
                    .limit(marginalSampleCount)
                    .forEach(v -> w(report, MarkdownTable.row(
                            "Bus" + v.busId(), v.name(), ReportFormat.fmt4(v.voltage()))));
            w(report, "");
        }

        w(report, "**P0 Voltage Result:** " + MarkdownTable.statusBadge(voltage.passed()));
        if (!voltage.passed()) {
            w(report, "");
            w(report, "> **Action Required:** Review voltage profile, consider capacitor bank additions,");
            w(report, "> OLTC tap adjustments, or generator voltage setpoint changes at affected buses.");
        }
        w(report, "");

        // 1.2 Branch Thermal Loading
        w(report, "### 1.2 Branch Thermal Loading Assessment");
        w(report, "");

        if (ratingsUnavailable) {
            w(report, "**P0 Thermal Result: INCONCLUSIVE**");
            w(report, "");
            w(report, "> **Critical Data Gap:** Branch MVA ratings (`LimMvaA`) are not populated in the");
            w(report, "> input data. All **" + branchLoad.totalBranches()
                    + " branches** show a **0.0 MVA rating** in the dataset.");
            w(report, "> Thermal loading assessment requires valid branch MVA ratings.");
        } else {
            w(report, "Branches with MVA ratings: " + branchLoad.branchesWithRatings() + "/"
                    + branchLoad.totalBranches());
            w(report, "");

            List<BranchLoadingAnalyzer.BranchFlow> overloadsP0 = branchLoad.overloaded();
            if (!overloadsP0.isEmpty()) {
                w(report, "#### P0 Overloaded Circuits (>" + ReportFormat.fmt0(overloadPct)
                        + "%) — " + overloadsP0.size() + " Circuits");
                w(report, "");
                w(report, MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"));
                w(report, MarkdownTable.separator(5));
                for (BranchLoadingAnalyzer.BranchFlow bf : overloadsP0) {
                    w(report, MarkdownTable.row(
                            bf.name(),
                            bf.from() + " → " + bf.to(),
                            "**" + ReportFormat.fmt1(bf.sMva()) + "**",
                            fmt1Nullable(bf.ratingMva()),
                            "**" + ReportFormat.fmt1(bf.loadingPct()) + "**"));
                }
                w(report, "");
            }

            if (!branchLoad.heavilyLoaded().isEmpty()) {
                w(report, "#### Heavily Loaded Branches (" + ReportFormat.fmt0(heavyPct) + "–"
                        + ReportFormat.fmt0(overloadPct) + "%) — "
                        + branchLoad.heavilyLoaded().size() + " Circuits");
                w(report, "");
                w(report, MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"));
                w(report, MarkdownTable.separator(5));
                List<BranchLoadingAnalyzer.BranchFlow> heavilyLoaded = branchLoad.heavilyLoaded();
                for (BranchLoadingAnalyzer.BranchFlow bf : heavilyLoaded.stream()
                        .limit(maxHeavilyLoaded).toList()) {
                    w(report, MarkdownTable.row(
                            bf.name(),
                            bf.from() + " → " + bf.to(),
                            ReportFormat.fmt1(bf.sMva()),
                            fmt1Nullable(bf.ratingMva()),
                            ReportFormat.fmt1(bf.loadingPct())));
                }
                if (heavilyLoaded.size() > maxHeavilyLoaded) {
                    w(report, "*... and " + (heavilyLoaded.size() - maxHeavilyLoaded) + " more circuits*");
                }
                w(report, "");
            }

            if (!branchLoad.moderateLoaded().isEmpty()) {
                w(report, "#### Moderately Loaded Branches (" + ReportFormat.fmt0(moderatePct) + "–"
                        + ReportFormat.fmt0(heavyPct) + "%) — "
                        + branchLoad.moderateLoaded().size() + " Circuits");
                w(report, "");
                w(report, MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Loading %"));
                w(report, MarkdownTable.separator(4));
                List<BranchLoadingAnalyzer.BranchFlow> moderateLoaded = branchLoad.moderateLoaded();
                for (BranchLoadingAnalyzer.BranchFlow bf : moderateLoaded.stream()
                        .limit(maxModerateLoaded).toList()) {
                    w(report, MarkdownTable.row(
                            bf.name(),
                            bf.from() + " → " + bf.to(),
                            ReportFormat.fmt1(bf.sMva()),
                            ReportFormat.fmt1(bf.loadingPct())));
                }
                if (moderateLoaded.size() > maxModerateLoaded) {
                    w(report, "*... and " + (moderateLoaded.size() - maxModerateLoaded) + " more circuits*");
                }
                w(report, "");
            }

            w(report, "#### Top 5 Loaded Circuits");
            w(report, "");
            w(report, MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"));
            w(report, MarkdownTable.separator(5));
            for (BranchLoadingAnalyzer.BranchFlow bf : branchLoad.top5()) {
                w(report, MarkdownTable.row(
                        bf.name(),
                        bf.from() + " → " + bf.to(),
                        ReportFormat.fmt1(bf.sMva()),
                        fmt1Nullable(bf.ratingMva()),
                        ReportFormat.fmt1(bf.loadingPct())));
            }
            w(report, "");

            if (!overloadsP0.isEmpty()) {
                w(report, "**P0 Thermal Result: FAIL** (" + overloadsP0.size() + " overloads detected)");
            } else {
                w(report, "**P0 Thermal Result: PASS** (no overloads)");
            }
            w(report, "");

            if (branchLoad.hasRatingsB()) {
                List<BranchLoadingAnalyzer.BranchFlow> overloadedB = branchLoad.overloadedB();
                List<BranchLoadingAnalyzer.BranchFlow> heavyB = branchLoad.heavyLoadedB();
                if (!overloadedB.isEmpty() || !heavyB.isEmpty()) {
                    w(report, "#### Rate B (Emergency) Loading Summary");
                    w(report, "");
                    w(report, "> Rate B (emergency) ratings are used for P3–P7 category thermal compliance. "
                            + "Branches exceeding Rate B limits in the base case warrant attention.");
                    w(report, "");
                    if (!overloadedB.isEmpty()) {
                        w(report, "- **" + overloadedB.size()
                                + " circuits** exceed 100% of Rate B in the base case");
                    }
                    if (!heavyB.isEmpty()) {
                        w(report, "- **" + heavyB.size()
                                + " circuits** operate above 80% of Rate B in the base case");
                    }
                    w(report, "");
                    if (!overloadedB.isEmpty()) {
                        w(report, MarkdownTable.row("Branch", "From–To", "Rate A Loading %",
                                "Rate B Loading %", "Rate B Rating (MVA)"));
                        w(report, MarkdownTable.separator(5));
                        for (BranchLoadingAnalyzer.BranchFlow bf : overloadedB.stream().limit(5).toList()) {
                            w(report, MarkdownTable.row(
                                    bf.name(),
                                    bf.from() + " → " + bf.to(),
                                    ReportFormat.fmt1(bf.loadingPct()),
                                    "**" + ReportFormat.fmt1(bf.loadingPctB()) + "**",
                                    fmt1Nullable(bf.ratingMvaB())));
                        }
                        w(report, "");
                    }
                }
            }
            w(report, "");
        }

        // 1.3 Generator Reactive Power
        w(report, "### 1.3 Generator Reactive Power Assessment");
        w(report, "");
        w(report, "**P0 Generator Q-Limit Result:** " + MarkdownTable.statusBadge(qPass));
        w(report, "");

        if (!qPass) {
            w(report, "#### Generator Q-Limit Violations — " + genQ.violations().size() + " Violations");
            w(report, "");
            w(report, MarkdownTable.row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)"));
            w(report, MarkdownTable.separator(5));
            for (GeneratorQAnalyzer.QViolation v : genQ.violations()) {
                w(report, MarkdownTable.row(
                        "Bus" + v.bus(), v.name(),
                        ReportFormat.fmt4(v.q()),
                        ReportFormat.fmt4(v.qmax()),
                        ReportFormat.fmt4(v.qmin())));
            }
            w(report, "");
        }

        if (!genQ.atLimit().isEmpty()) {
            w(report, "#### Generators at Q-Limit — " + genQ.atLimit().size() + " Units");
            w(report, "");
            List<GeneratorQAnalyzer.QAtLimit> displayQ =
                    genQ.atLimit().stream().limit(maxQLimit).toList();
            w(report, MarkdownTable.row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)", "At Limit"));
            w(report, MarkdownTable.separator(6));
            for (GeneratorQAnalyzer.QAtLimit g : displayQ) {
                String limitLabel = Math.abs(g.qmax() - g.q()) < qAtLimitMargin
                        ? "**Qmax**"
                        : "**Qmin**";
                w(report, MarkdownTable.row(
                        "Bus" + g.bus(), g.name(),
                        ReportFormat.fmt4(g.q()),
                        ReportFormat.fmt4(g.qmax()),
                        ReportFormat.fmt4(g.qmin()),
                        limitLabel));
            }
            if (genQ.atLimit().size() > maxQLimit) {
                w(report, "");
                w(report, "*... and " + (genQ.atLimit().size() - maxQLimit) + " more units at limit*");
            }
            w(report, "");
            w(report, "> **Note:** Generators at Q-limit have been switched from PV to PQ mode during the");
            w(report, "> load flow solution, reducing voltage regulation capability in these areas.");
            w(report, "");
        }

        // Section 2: Contingency Analysis
        w(report, "## Section 2: Contingency Analysis (P1–P7)");
        w(report, "");

        w(report, "### 2.1 Critical Elements for N-1 Contingency Analysis");
        w(report, "");
        w(report, "#### Top 10 Most Heavily Loaded Circuits (Potential P1/P3/P5)");
        w(report, "");
        w(report, MarkdownTable.row("Rank", "Branch", "Flow (MVA)", "From", "To"));
        w(report, MarkdownTable.separator(5));
        int rank = 1;
        for (ContingencyAnalyzer.CriticalBranch cb : contingency.topBranches()) {
            double sMva = cb.s() * baseKva / 1000;
            w(report, MarkdownTable.row(rank++, cb.name(), ReportFormat.fmt1(sMva),
                    cb.from(), cb.to()));
        }
        w(report, "");

        w(report, "#### Top 10 Largest Generators (Potential P1 Events)");
        w(report, "");
        w(report, MarkdownTable.row("Rank", "Bus", "Name", "P Output (MW)"));
        w(report, MarkdownTable.separator(4));
        rank = 1;
        for (ContingencyAnalyzer.CriticalGen cg : contingency.topGens()) {
            double pMw = cg.pout() * baseKva / 1000;
            w(report, MarkdownTable.row(rank++, "Bus" + cg.bus(), cg.name(), ReportFormat.fmt1(pMw)));
        }
        w(report, "");

        // 2.2 Parallel Circuits
        w(report, "### 2.2 Parallel Circuits (P3/P5 Common-Mode Events)");
        w(report, "");
        if (!parallel.isEmpty()) {
            int nPar = parallel.size();
            w(report, "**" + nPar + " parallel bus-pairs** (identical from–to with multiple circuit IDs) are candidates "
                    + "for P3 (common-mode) and P5 (delayed fault) contingency assessment. "
                    + "Full per-pair listing is omitted for large models.");
            w(report, "");

            Map<Integer, Integer> circHist = new TreeMap<>();
            for (List<String> names : parallel.values()) {
                circHist.merge(names.size(), 1, Integer::sum);
            }
            int maxCirc = circHist.keySet().stream().max(Integer::compareTo).orElse(0);

            w(report, MarkdownTable.row("Metric", "Value"));
            w(report, MarkdownTable.separator(2));
            w(report, MarkdownTable.row("Parallel bus-pairs", String.valueOf(nPar)));
            for (Map.Entry<Integer, Integer> entry : circHist.entrySet()) {
                w(report, MarkdownTable.row(
                        "Pairs with " + entry.getKey() + " parallel circuits",
                        String.valueOf(entry.getValue())));
            }
            w(report, MarkdownTable.row("Maximum circuits on one corridor", String.valueOf(maxCirc)));
            w(report, "");
            w(report, "**Sample bus-pairs (10 lowest bus numbers, stable ordering):**");
            w(report, "");

            List<Map.Entry<List<String>, List<String>>> sample = parallel.entrySet().stream()
                    .sorted(Comparator.comparingInt(NercTplReportGenerator::pairSortPrimary)
                            .thenComparingInt(NercTplReportGenerator::pairSortSecondary))
                    .limit(10)
                    .toList();

            w(report, MarkdownTable.row("Bus Pair", "Circuits", "Parallel Circuits"));
            w(report, MarkdownTable.separator(3));
            for (Map.Entry<List<String>, List<String>> entry : sample) {
                List<String> key = entry.getKey();
                List<String> names = entry.getValue();
                w(report, MarkdownTable.row(
                        "Bus" + key.get(0) + " ↔ Bus" + key.get(1),
                        String.valueOf(names.size()),
                        String.join(", ", names)));
            }
            w(report, "");
            w(report, "> **Note:** These parallel circuits, if physically located on common tower");
            w(report, "> structures, constitute P3 events (N-2 loss on common ROW).");
        } else {
            w(report, "No parallel circuits identified.");
        }
        w(report, "");

        // 2.3 Contingency Results
        if (contingencyResults != null) {
            w(report, "### 2.3 N-1 Contingency Analysis Results");
            w(report, "");
            w(report, "Contingency analysis was performed on **"
                    + contingencyResults.totalContingencies() + " unique N-1 contingencies**, ");
            w(report, "monitoring **" + contingencyResults.totalMonitored()
                    + "** branch flow conditions.");
            w(report, "");

            w(report, "#### P1 Thermal Compliance Summary");
            w(report, "");
            w(report, MarkdownTable.row("Metric", "Value"));
            w(report, MarkdownTable.separator(2));
            w(report, MarkdownTable.row("Contingencies Run",
                    contingencyResults.totalContingencies()));
            w(report, MarkdownTable.row("Monitored Branches",
                    contingencyResults.totalMonitored()));
            w(report, MarkdownTable.row("Post-Contingency Overloads",
                    contingencyResults.totalOverloads()));
            int severeTh = (int) severePct;
            w(report, MarkdownTable.row("Severe Overloads (>" + severeTh + "%)",
                    contingencyResults.severeOverloads().size()));
            w(report, MarkdownTable.row("P1 Thermal Status",
                    MarkdownTable.statusBadge(contingencyResults.p1ThermalPass())));
            w(report, "");

            if (!contingencyResults.overloads().isEmpty()
                    || !contingencyResults.severeOverloads().isEmpty()) {
                w(report, "#### Post-Contingency Overloads");
                w(report, "");
                w(report, MarkdownTable.row("Monitored Branch", "Outage (Contingency)",
                        "Base Flow (MW)", "Post Flow (MW)", "Rating (MW)", "Loading %"));
                w(report, MarkdownTable.separator(6));

                List<ContingencyAnalyzer.ContingencyOverload> allOverloads = new ArrayList<>();
                allOverloads.addAll(contingencyResults.severeOverloads());
                allOverloads.addAll(contingencyResults.overloads());

                for (ContingencyAnalyzer.ContingencyOverload ol : allOverloads.stream()
                        .limit(maxContingencyOverloads).toList()) {
                    w(report, MarkdownTable.row(
                            ol.branch(),
                            ol.contingency(),
                            ReportFormat.fmt1(ol.baseFlow()),
                            "**" + ReportFormat.fmt1(ol.postFlow()) + "**",
                            ReportFormat.fmt1(ol.rating()),
                            "**" + ReportFormat.fmt1(ol.loadingPct()) + "**"));
                }
                if (allOverloads.size() > maxContingencyOverloads) {
                    w(report, "");
                    w(report, "*... and " + (allOverloads.size() - maxContingencyOverloads)
                            + " more overloads*");
                }
                w(report, "");
                w(report, "> **NERC TPL-001-5 P1 Requirement:** Post-contingency thermal loading must not exceed");
                w(report, "> 100% of Rate A. These overloads indicate **P1 non-compliance** for the listed contingencies.");
                w(report, "> Mitigation options include: line uprating, series compensation, generation redispatch,");
                w(report, "> or transmission expansion.");
                w(report, "");
            } else {
                w(report, "**No post-contingency thermal overloads detected.** All monitored branches remain within");
                w(report, "their MVA ratings under N-1 contingency conditions. **P1 thermal criteria PASS.**");
                w(report, "");
            }
        } else {
            w(report, "### 2.3 N-1 Contingency Analysis Results");
            w(report, "");
            w(report, "> **Note:** No contingency analysis data (`_DF_contingency.csv`) found for this case.");
            w(report, "> Run contingency analysis using:");
            w(report, ">");
            w(report, "> ```bash");
            w(report, "> java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca <format> <input> [<cont_file> <monitor_file>]");
            w(report, "> ```");
            w(report, "");
        }

        // Section 3: Assessment & Recommendations
        w(report, "## Section 3: Assessment and Recommendations");
        w(report, "");

        w(report, "### 3.1 P0 Base Case Assessment");
        w(report, "");
        w(report, MarkdownTable.row("Criterion", "Result", "Status"));
        w(report, MarkdownTable.separator(3));
        w(report, MarkdownTable.row("Voltage Compliance",
                voltage.violationsLow().size() + " buses below " + ReportFormat.fmt2(p0VMin) + " pu",
                MarkdownTable.statusBadge(voltage.passed())));

        if (ratingsUnavailable) {
            w(report, MarkdownTable.row("Thermal Compliance", "Ratings not available", "INCONCLUSIVE"));
        } else {
            List<BranchLoadingAnalyzer.BranchFlow> overloadsP0 = branchLoad.overloaded();
            if (!overloadsP0.isEmpty()) {
                w(report, MarkdownTable.row("Thermal Compliance",
                        overloadsP0.size() + " overloaded circuits",
                        MarkdownTable.statusBadge(false)));
            } else {
                w(report, MarkdownTable.row("Thermal Compliance", "No overloads",
                        MarkdownTable.statusBadge(true)));
            }
        }

        w(report, MarkdownTable.row("Generator Q-Limits",
                genQ.atLimit().size() + " at limit, " + genQ.violations().size() + " violations",
                MarkdownTable.statusBadge(qPass)));

        if (p0OverallPass) {
            w(report, MarkdownTable.row("**P0 OVERALL**", "All criteria met", "**COMPLIANT**"));
        } else if (p0ThermalInconclusive) {
            w(report, MarkdownTable.row("**P0 OVERALL**", p0Description, "**INCONCLUSIVE**"));
        } else {
            w(report, MarkdownTable.row("**P0 OVERALL**", p0Description, "**NON-COMPLIANT**"));
        }
        w(report, "");

        if (!voltage.passed()) {
            w(report, "#### Voltage Issues");
            w(report, "");
            if (!voltage.violationsLow().isEmpty()) {
                w(report, "- **" + voltage.violationsLow().size()
                        + " buses** violate the " + ReportFormat.fmt2(p0VMin) + " pu minimum");
            }
            if (!voltage.violationsHigh().isEmpty()) {
                w(report, "- **" + voltage.violationsHigh().size()
                        + " buses** exceed the " + ReportFormat.fmt2(p0VMax) + " pu maximum");
            }
            int nActiveBuses = voltage.busesAnalyzed() > 0 ? voltage.busesAnalyzed() : buses.size();
            double pctMarginal = nActiveBuses > 0
                    ? voltage.lowVoltageWarn().size() / (double) nActiveBuses * 100
                    : 0;
            w(report, "- **" + voltage.lowVoltageWarn().size() + " buses** ("
                    + ReportFormat.fmt0(pctMarginal) + "% of in-service buses) "
                    + "operate in the marginal range (" + ReportFormat.fmt2(p0VMin) + "–"
                    + ReportFormat.fmt2(p0VMargLow) + " pu)");
            w(report, "");
            w(report, "**Recommendations:**");
            w(report, "- Add capacitor banks at affected low-voltage buses");
            w(report, "- Review OLTC tap settings on transformers in voltage-depressed corridors");
            w(report, "- Consider adjusting generator voltage setpoints on nearby PV buses");
            w(report, "");
        } else if (!voltage.lowVoltageWarn().isEmpty()) {
            w(report, "#### Voltage Observations");
            w(report, "");
            w(report, "- All bus voltages are within the required "
                    + ReportFormat.fmt2(p0VMin) + "–" + ReportFormat.fmt2(p0VMax) + " pu range");
            w(report, "- **" + voltage.lowVoltageWarn().size() + " buses** are in the marginal range ("
                    + ReportFormat.fmt2(p0VMin) + "–" + ReportFormat.fmt2(p0VMargLow)
                    + " pu) — monitor during contingency analysis");
            w(report, "");
        } else {
            w(report, "#### Voltage Observations");
            w(report, "");
            w(report, "- All bus voltages are within the required "
                    + ReportFormat.fmt2(p0VMin) + "–" + ReportFormat.fmt2(p0VMax) + " pu range with no marginal buses");
            w(report, "- Voltage range: " + ReportFormat.fmt4(voltage.vMin()) + " – "
                    + ReportFormat.fmt4(voltage.vMax()) + " pu");
            w(report, "");
        }

        if (!genQ.atLimit().isEmpty()) {
            w(report, "#### Generator Q-Limit Findings");
            w(report, "");
            int qminCount = 0;
            for (GeneratorQAnalyzer.QAtLimit g : genQ.atLimit()) {
                if (Math.abs(g.q() - g.qmin()) < qAtLimitMargin) {
                    qminCount++;
                }
            }
            int qmaxCount = genQ.atLimit().size() - qminCount;
            List<String> parts = new ArrayList<>();
            if (qminCount > 0) {
                parts.add("**" + qminCount + " at Qmin**");
            }
            if (qmaxCount > 0) {
                parts.add("**" + qmaxCount + " at Qmax**");
            }
            w(report, "- " + String.join(", ", parts) + " with no remaining reactive power margin");
            w(report, "- Generators at limit reduce voltage regulation capability during contingencies");
            if (qmaxCount > 0) {
                w(report, "- Generators at Qmax indicate constrained reactive power supply");
            }
            if (qminCount > 0) {
                w(report, "- Generators at Qmin may indicate over-excitation or absorption limits");
            }
            w(report, "- PV→PQ switching occurred for these buses during solution");
            w(report, "");
        }

        if (ratingsUnavailable) {
            w(report, "#### Branch Rating Issue");
            w(report, "");
            w(report, "- **CRITICAL:** All " + branchLoad.totalBranches()
                    + " branch MVA ratings (`LimMvaA`) are **missing** from the input data");
            w(report, "- Thermal overload compliance cannot be evaluated without valid ratings");
            w(report, "- **Action Required:** Populate `LimMvaA`, `LimMvaB`, and `LimMvaC` for every branch");
            w(report, "");
        } else {
            int overloadPctInt = (int) overloadPct;
            int heavyPctInt = (int) heavyPct;
            List<BranchLoadingAnalyzer.BranchFlow> overloadsP0 = branchLoad.overloaded();
            if (!overloadsP0.isEmpty()) {
                w(report, "#### Branch Overload Findings");
                w(report, "");
                w(report, "- **" + overloadsP0.size() + " circuits** exceed " + overloadPctInt
                        + "% of Rate A in the base case");
                w(report, "- " + branchLoad.heavilyLoaded().size() + " circuits operate above "
                        + heavyPctInt + "% loading");
                w(report, "- **Recommendation:** Review overloaded circuits for uprating, reconfiguration, or generation redispatch");
                w(report, "");
            } else {
                w(report, "#### Branch Loading Observations");
                w(report, "");
                w(report, "- All circuits are within their MVA ratings in the base case");
                if (!branchLoad.heavilyLoaded().isEmpty()) {
                    w(report, "- " + branchLoad.heavilyLoaded().size()
                            + " circuits operate above " + heavyPctInt
                            + "% loading — monitor during contingency analysis");
                }
                w(report, "");
            }
        }

        w(report, "### 3.2 P1–P6 Contingency Analysis Assessment");
        w(report, "");

        if (contingencyResults != null && contingencyResults.totalOverloads() > 0) {
            w(report, "#### P1 (N-1) Contingency Thermal Assessment");
            w(report, "");
            w(report, "- **" + contingencyResults.totalContingencies()
                    + "** N-1 contingencies evaluated against "
                    + branchLoad.branchesWithRatings() + " branches with ratings");
            w(report, "- **" + contingencyResults.totalOverloads()
                    + " post-contingency overloads** detected (N-1 thermal violations)");
            int severeTh = (int) severePct;
            w(report, "- **" + contingencyResults.severeOverloads().size()
                    + " overloads exceed " + severeTh + "%** of line rating — require urgent mitigation");
            w(report, "- **P1 Thermal Status: "
                    + MarkdownTable.statusBadge(contingencyResults.p1ThermalPass()) + "**");
            w(report, "");
            if (!genQ.atLimit().isEmpty()) {
                w(report, "- **" + genQ.atLimit().size()
                        + "** generators at reactive power limits reduce post-contingency voltage support capability");
                w(report, "");
            }
        } else if (contingencyResults != null && contingencyResults.p1ThermalPass()) {
            w(report, "#### P1 (N-1) Contingency Thermal Assessment");
            w(report, "");
            w(report, "- **" + contingencyResults.totalContingencies() + "** N-1 contingencies evaluated");
            w(report, "- **No post-contingency thermal overloads** detected");
            w(report, "- **P1 Thermal Status: PASS**");
            w(report, "");
        } else {
            w(report, "No contingency analysis data available. The following analysis is required:");
            w(report, "");
            w(report, "1. **Run N-1 contingency analysis** on the top 10 most heavily loaded circuits");
            w(report, "2. **Test N-1 loss** of the 10 largest generators");
            w(report, "3. **Evaluate P3 common-mode events** for all " + parallel.size()
                    + " parallel circuit pairs");
            w(report, "4. **Assess transformer outages** for voltage support impact");
            w(report, "5. **Run N-1-1 analysis** for sequential contingencies");
            if (ratingsUnavailable) {
                w(report, "6. **Populate branch MVA ratings** and re-run thermal compliance assessment");
            }
            w(report, "");
        }

        w(report, "#### Remaining NERC TPL-001-5 Analysis Work");
        w(report, "");
        w(report, "**P2 (Bus section/breaker):** Not evaluated — requires bus-breaker model data.");
        if (!parallel.isEmpty()) {
            w(report, "**P3/P5 (Common ROW/Delayed fault):** Not evaluated — " + parallel.size()
                    + " parallel circuit pair(s) identified as candidates.");
        } else {
            w(report, "**P3/P5 (Common ROW/Delayed fault):** No parallel circuit pairs identified.");
        }
        w(report, "**P4 (Breaker failure):** Not evaluated — requires breaker failure analysis tools.");
        w(report, "**P6 (N-1-1):** Not evaluated — requires sequential contingency analysis.");
        w(report, "**P7 (Extreme events):** Not evaluated — requires extreme event scenario definition.");
        w(report, "");

        // 3.3 Data Quality
        w(report, "### 3.3 Data Quality Assessment");
        w(report, "");
        w(report, MarkdownTable.row("Data Field", "Status", "Notes"));
        w(report, MarkdownTable.separator(3));

        if (ratingsUnavailable) {
            w(report, MarkdownTable.row("Branch MVA Ratings (`LimMvaA`)", "**MISSING**",
                    "All " + branchLoad.totalBranches()
                            + " branches show 0.0. Required for thermal compliance."));
        } else {
            w(report, MarkdownTable.row("Branch MVA Ratings (`LimMvaA`)", "**PRESENT**",
                    branchLoad.branchesWithRatings() + "/" + branchLoad.totalBranches()
                            + " branches have valid ratings."));
        }

        if (branchLoad.hasRatingsB()) {
            w(report, MarkdownTable.row("Branch MVA Ratings (`LimMvaB`)", "**PRESENT**",
                    branchLoad.branchesWithRatingsB() + "/" + branchLoad.totalBranches()
                            + " branches have valid emergency (Rate B) ratings."));
        } else {
            w(report, MarkdownTable.row("Branch MVA Ratings (`LimMvaB`)", "MISSING",
                    "Emergency (Rate B) ratings not populated."));
        }

        if (branchLoad.hasRatingsC()) {
            w(report, MarkdownTable.row("Branch MVA Ratings (`LimMvaC`)", "**PRESENT**",
                    branchLoad.branchesWithRatingsC() + "/" + branchLoad.totalBranches()
                            + " branches have valid Rate C ratings."));
        } else {
            w(report, MarkdownTable.row("Branch MVA Ratings (`LimMvaC`)", "MISSING",
                    "Rate C ratings not populated."));
        }

        int vschedCount = 0;
        for (Map<String, String> g : gens) {
            if (BusAnalysisUtil.parseDouble(g, "VSched") > 0) {
                vschedCount++;
            }
        }
        w(report, MarkdownTable.row("Bus Voltage Setpoints",
                vschedCount > 0 ? "PRESENT" : "MISSING",
                vschedCount + " of " + gens.size() + " generator buses have VSched."));

        int qDefined = 0;
        for (Map<String, String> g : gens) {
            if (BusAnalysisUtil.parseDouble(g, "QMax") != 0
                    || BusAnalysisUtil.parseDouble(g, "QMin") != 0) {
                qDefined++;
            }
        }
        w(report, MarkdownTable.row("Generator Q Limits",
                qDefined > 0 ? "PRESENT" : "MISSING",
                "QMax/QMin defined for " + qDefined + " buses."));

        w(report, MarkdownTable.row("Transformer Tap Data", "PRESENT",
                "Ratio and tap data included in model."));

        int loadDefined = 0;
        for (Map<String, String> l : loads) {
            if (BusAnalysisUtil.parseDouble(l, "PLoadTotal") != 0
                    || BusAnalysisUtil.parseDouble(l, "QLoadTotal") != 0) {
                loadDefined++;
            }
        }
        w(report, MarkdownTable.row("Load Data",
                loadDefined > 0 ? "PRESENT" : "MISSING",
                loadDefined + " loads defined with P and Q values."));

        int nXfmr = branchLoad.totalTransformers();
        int nLines = branchLoad.totalLines();
        String branchComposition;
        if (branchLoad.totalBranches() > 0) {
            double xfmrPct = nXfmr / (double) branchLoad.totalBranches() * 100;
            branchComposition = nLines + " lines, " + nXfmr + " transformers ("
                    + ReportFormat.pct1(xfmrPct) + " xfmrs)";
        } else {
            branchComposition = "N/A";
        }
        w(report, MarkdownTable.row("Branch Composition", "", branchComposition));

        if (contingencyResults != null) {
            w(report, MarkdownTable.row("Contingency Data", "**PRESENT**",
                    contingencyResults.totalContingencies() + " contingencies evaluated."));
        } else {
            w(report, MarkdownTable.row("Contingency Data", "MISSING",
                    "Run `java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca` to generate contingency analysis."));
        }
        w(report, "");

        // Footer
        w(report, "---");
        w(report, "");
        w(report, "## Report Metadata");
        w(report, "");
        w(report, MarkdownTable.row("Field", "Value"));
        w(report, MarkdownTable.separator(2));
        w(report, MarkdownTable.row("Generated By", GENERATED_BY));
        w(report, MarkdownTable.row("Case", caseName));
        Path wspace = paths.wspaceDir().normalize().toAbsolutePath();
        Path normalizedCaseBase = caseBase.normalize().toAbsolutePath();
        String srcRel = wspace.relativize(normalizedCaseBase).toString().replace('\\', '/');
        w(report, MarkdownTable.row("Source Data", "`" + srcRel + "/" + prefix + "_DF_*.csv`"));
        w(report, MarkdownTable.row("Input File", sourceDesc));
        w(report, MarkdownTable.row("NERC Standard",
                "TPL-001-5 (Transmission System Planning Performance)"));
        w(report, "");
        w(report, "---");
        w(report, "");
        w(report, "> **End of NERC TPL-001-5 Compliance Assessment Report**");

        return String.join("\n", report);
    }

    private static void w(List<String> report, String line) {
        report.add(line);
    }

    private static double sumField(List<Map<String, String>> rows, String key) {
        double sum = 0;
        for (Map<String, String> row : rows) {
            sum += BusAnalysisUtil.parseDouble(row, key);
        }
        return sum;
    }

    private static double findGenDouble(List<Map<String, String>> gens, String busNum, String field) {
        for (Map<String, String> gen : gens) {
            if (busNum.equals(gen.get("BusNumber"))) {
                return BusAnalysisUtil.parseDouble(gen, field);
            }
        }
        return 0;
    }

    private static double number(Object value, double fallback) {
        return value instanceof Number n ? n.doubleValue() : fallback;
    }

    private static String fmt1Nullable(Double value) {
        return value == null ? "0.0" : ReportFormat.fmt1(value);
    }

    private static int pairSortPrimary(Map.Entry<List<String>, List<String>> item) {
        String fa = item.getKey().get(0);
        String ta = item.getKey().get(1);
        return Math.min(parseBusNum(fa), parseBusNum(ta));
    }

    private static int pairSortSecondary(Map.Entry<List<String>, List<String>> item) {
        String fa = item.getKey().get(0);
        String ta = item.getKey().get(1);
        return Math.max(parseBusNum(fa), parseBusNum(ta));
    }

    private static int parseBusNum(String x) {
        try {
            return Integer.parseInt(x.strip());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
