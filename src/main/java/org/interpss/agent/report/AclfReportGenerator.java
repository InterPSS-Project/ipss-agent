package org.interpss.agent.report;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import org.interpss.agent.util.ProjectPaths;

public final class AclfReportGenerator {

    private static final DateTimeFormatter REPORT_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    public record ReportResult(String markdown, Path caseBase, String prefix) {
    }

    private AclfReportGenerator() {
    }

    public static ReportResult generate(
            ProjectPaths paths,
            ReportConfig cfg,
            String displayName,
            String resultDir,
            String csvPrefix,
            Clock clock) throws IOException {
        ReportCaseResolver.ResolvedCase resolved = ReportCaseResolver.resolve(paths, resultDir, csvPrefix);
        Path caseBase = resolved.caseBase();
        String prefix = resolved.prefix();
        String sourceDesc = ReportCaseResolver.sourceDescription(paths, caseBase);

        List<Map<String, String>> buses = CsvDataLoader.loadRequired(caseBase, prefix + "_DF_bus.csv");
        List<Map<String, String>> branches = CsvDataLoader.loadRequired(caseBase, prefix + "_DF_branch.csv");
        List<Map<String, String>> gens = CsvDataLoader.loadRequired(caseBase, prefix + "_DF_gen.csv");
        List<Map<String, String>> loads = CsvDataLoader.loadRequired(caseBase, prefix + "_DF_load.csv");
        NetworkInfoParser.NetworkInfo networkInfo = NetworkInfoParser.parse(caseBase, prefix);

        VoltageAnalyzer.VoltageProfileResult voltage = VoltageAnalyzer.analyze(buses, cfg);
        BranchLoadingAnalyzer.BranchLoadingResult branchLoad = BranchLoadingAnalyzer.analyze(branches, cfg);
        GeneratorQAnalyzer.GeneratorQResult genQ = GeneratorQAnalyzer.analyze(gens, cfg);

        double totalGenP = sumColumn(gens, "PGen");
        double totalGenQ = sumColumn(gens, "QGen");
        double totalLoadP = sumColumn(loads, "PLoadTotal");
        double totalLoadQ = sumColumn(loads, "QLoadTotal");
        double lossesP = totalGenP - totalLoadP;
        double lossesQ = totalGenQ - totalLoadQ;

        List<Map<String, String>> pvBuses = buses.stream().filter(b -> "PV".equals(b.get("BusType"))).toList();
        List<Map<String, String>> pqBuses = buses.stream().filter(b -> "PQ".equals(b.get("BusType"))).toList();
        List<Map<String, String>> swingBuses = buses.stream().filter(b -> "Swing".equals(b.get("BusType"))).toList();

        String swingBusNum = swingBuses.isEmpty() ? null : swingBuses.get(0).get("Number");
        String swingBusName = swingBuses.isEmpty() ? "Unknown" : BusAnalysisUtil.strip(swingBuses.get(0), "Name");
        double swingVsched = swingBusNum == null ? 0 : genAtBus(gens, swingBusNum, "VSched");
        double swingP = swingBusNum == null ? 0 : genAtBus(gens, swingBusNum, "PGen");
        double swingQ = swingBusNum == null ? 0 : genAtBus(gens, swingBusNum, "QGen");

        double baseMvaVal = cfg.baseMva();
        List<String> report = new ArrayList<>();

        appendTitle(report, displayName, baseMvaVal, clock, sourceDesc, prefix, networkInfo);
        appendNetworkSummary(report, networkInfo, prefix);
        appendExecutiveSummary(report, buses.size(), loads.size(), pqBuses, pvBuses, swingBuses,
                branchLoad, genQ, totalLoadP, totalLoadQ, totalGenP, totalGenQ, lossesP, lossesQ,
                swingBusNum, swingBusName, swingVsched, swingP, swingQ, baseMvaVal);
        appendVoltageProfile(report, cfg, voltage);
        appendBranchLoading(report, cfg, branchLoad);
        appendGeneratorQ(report, cfg, genQ);
        appendFooter(report, displayName, paths, caseBase, prefix);

        return new ReportResult(String.join("\n", report), caseBase, prefix);
    }

    private static void appendTitle(
            List<String> report,
            String displayName,
            double baseMvaVal,
            Clock clock,
            String sourceDesc,
            String prefix,
            NetworkInfoParser.NetworkInfo networkInfo) {
        report.add("# AC Load Flow Report");
        report.add("");
        report.add("**" + displayName + "**");
        report.add("");
        report.add("---");
        report.add("");
        report.add(MarkdownTable.row("Field", "Value"));
        report.add(MarkdownTable.separator(2));
        report.add(MarkdownTable.row("**System**", displayName));
        report.add(MarkdownTable.row("**Base MVA**", ReportFormat.fmt0(baseMvaVal) + " MVA"));
        report.add(MarkdownTable.row("**Report Date**", LocalDateTime.now(clock).format(REPORT_TIME)));
        report.add(MarkdownTable.row("**Input**", sourceDesc));
        report.add(MarkdownTable.row("**Source CSV Prefix**", "`" + prefix + "_DF_*.csv`"));
        if (networkInfo != null && !networkInfo.loadflowRun().isEmpty()) {
            report.add(MarkdownTable.row("**Loadflow Converged**",
                    networkInfo.loadflowRun().getOrDefault("Loadflow converged", "N/A")));
        }
        report.add("");
    }

    private static void appendNetworkSummary(
            List<String> report,
            NetworkInfoParser.NetworkInfo networkInfo,
            String prefix) {
        report.add("## AclfNetwork Summary");
        report.add("");
        if (networkInfo != null) {
            report.add(MarkdownTable.row("Parameter", "Value"));
            report.add(MarkdownTable.separator(2));
            networkInfo.aclfNetwork().forEach((key, value) -> report.add(MarkdownTable.row(key, value)));
            if (!networkInfo.loadflowRun().isEmpty()) {
                report.add(MarkdownTable.row("Loadflow Converged",
                        networkInfo.loadflowRun().getOrDefault("Loadflow converged", "N/A")));
                report.add(MarkdownTable.row("Max Mismatch",
                        networkInfo.loadflowRun().getOrDefault("Max mismatch", "N/A")));
            }
            report.add("");
        } else {
            report.add("> **Note:** No `" + prefix + "_network_info.txt` found alongside the CSVs. "
                    + "Solver-reported network statistics and convergence flag are unavailable.");
            report.add("");
        }
    }

    private static void appendExecutiveSummary(
            List<String> report,
            int totalBuses,
            int totalLoads,
            List<Map<String, String>> pqBuses,
            List<Map<String, String>> pvBuses,
            List<Map<String, String>> swingBuses,
            BranchLoadingAnalyzer.BranchLoadingResult branchLoad,
            GeneratorQAnalyzer.GeneratorQResult genQ,
            double totalLoadP,
            double totalLoadQ,
            double totalGenP,
            double totalGenQ,
            double lossesP,
            double lossesQ,
            String swingBusNum,
            String swingBusName,
            double swingVsched,
            double swingP,
            double swingQ,
            double baseMvaVal) {
        report.add("## Executive Summary");
        report.add("");
        report.add(MarkdownTable.row("Metric", "Value"));
        report.add(MarkdownTable.separator(2));
        report.add(MarkdownTable.row("Total Buses",
                totalBuses + " (" + pqBuses.size() + " PQ, " + pvBuses.size() + " PV, "
                        + swingBuses.size() + " Swing)"));
        report.add(MarkdownTable.row("Total Branches",
                branchLoad.totalBranches() + " (" + branchLoad.branchesWithRatings() + " with MVA ratings, "
                        + branchLoad.totalLines() + " lines, " + branchLoad.totalTransformers() + " transformers)"));
        report.add(MarkdownTable.row("Total Generators", genQ.totalGens()));
        report.add(MarkdownTable.row("Total Loads", totalLoads));
        report.add(MarkdownTable.row("Total Load",
                ReportFormat.fmt2(totalLoadP) + " pu P / " + ReportFormat.fmt2(totalLoadQ) + " pu Q ("
                        + ReportFormat.fmt1(totalLoadP * baseMvaVal) + " MW / "
                        + ReportFormat.fmt1(totalLoadQ * baseMvaVal) + " MVAr)"));
        report.add(MarkdownTable.row("Total Generation",
                ReportFormat.fmt2(totalGenP) + " pu P / " + ReportFormat.fmt2(totalGenQ) + " pu Q ("
                        + ReportFormat.fmt1(totalGenP * baseMvaVal) + " MW / "
                        + ReportFormat.fmt1(totalGenQ * baseMvaVal) + " MVAr)"));
        report.add(MarkdownTable.row("System Losses",
                ReportFormat.fmt2(lossesP) + " pu P / " + ReportFormat.fmt2(lossesQ) + " pu Q ("
                        + ReportFormat.fmt1(lossesP * baseMvaVal) + " MW / "
                        + ReportFormat.fmt1(lossesQ * baseMvaVal) + " MVAr)"));
        if (swingBusNum != null) {
            report.add(MarkdownTable.row("Swing Bus",
                    "Bus" + swingBusNum + " (" + swingBusName + ") at " + ReportFormat.fmt4(swingVsched) + " pu"));
            report.add(MarkdownTable.row("Swing Output",
                    ReportFormat.fmt2(swingP) + " pu P / " + ReportFormat.fmt2(swingQ) + " pu Q"));
        }
        report.add("");
        report.add("> **Note:** Summary P/Q values are reported in per-unit on a "
                + ReportFormat.fmt0(baseMvaVal) + " MVA base unless otherwise noted.");
        report.add("");
    }

    private static void appendVoltageProfile(
            List<String> report,
            ReportConfig cfg,
            VoltageAnalyzer.VoltageProfileResult voltage) {
        @SuppressWarnings("unchecked")
        Map<String, Object> p0 = (Map<String, Object>) cfg.section("voltage").get("p0");
        @SuppressWarnings("unchecked")
        Map<String, Object> bandsCfg = (Map<String, Object>) cfg.section("voltage").get("bands");
        double vMinLimit = number(p0.get("v_min"), 0.95);
        double vMaxLimit = number(p0.get("v_max"), 1.05);
        double vMargLow = number(p0.get("v_marginal_low"), 0.98);

        report.add("## Steady-State Voltage Profile");
        report.add("");
        report.add("Voltage compliance bands below use planning-style limits of "
                + "**" + ReportFormat.fmt2(vMinLimit) + "–" + ReportFormat.fmt2(vMaxLimit) + " pu** "
                + "from `config/gen_report.json` (same thresholds the NERC report uses for P0). "
                + "They are reported here as *reference bands*, not as a NERC compliance verdict.");
        report.add("");
        report.add("### Voltage Extremes");
        report.add("");
        report.add(MarkdownTable.row("Metric", "Value", "Location"));
        report.add(MarkdownTable.separator(3));
        report.add(MarkdownTable.row("Minimum Voltage", "**" + ReportFormat.fmt4(voltage.vMin()) + " pu**",
                voltage.vMinBus()));
        report.add(MarkdownTable.row("Maximum Voltage", "**" + ReportFormat.fmt4(voltage.vMax()) + " pu**",
                voltage.vMaxBus()));
        report.add(MarkdownTable.row("Buses Analyzed (in-service)", voltage.busesAnalyzed(), ""));
        if (voltage.inactiveExcluded() > 0) {
            report.add(MarkdownTable.row("Out-of-Service Excluded", voltage.inactiveExcluded(), ""));
        }
        report.add("");

        if (!voltage.bands().isEmpty() && voltage.busesAnalyzed() > 0) {
            appendVoltageBands(report, cfg, voltage, bandsCfg, vMinLimit, vMaxLimit, vMargLow);
        }

        if (voltage.inactiveExcluded() > 0) {
            report.add("> **Note:** Voltage statistics use **in-service buses only** "
                    + "(`InService` in the bus CSV). **" + voltage.inactiveExcluded()
                    + "** out-of-service buses were excluded.");
            report.add("");
        }

        appendViolationTables(report, voltage, vMinLimit, vMaxLimit, vMargLow, cfg);
        report.add("**Voltage Within Planning Limits:** " + MarkdownTable.statusBadge(voltage.passed()));
        report.add("");
    }

    private static void appendVoltageBands(
            List<String> report,
            ReportConfig cfg,
            VoltageAnalyzer.VoltageProfileResult voltage,
            Map<String, Object> bandsCfg,
            double vMinLimit,
            double vMaxLimit,
            double vMargLow) {
        report.add("### Voltage Band Distribution");
        report.add("");
        report.add(MarkdownTable.row("Voltage Range", "Description", "Buses", "% of In-Service"));
        report.add(MarkdownTable.separator(4));

        Map<String, String> bandDescriptions = Map.of(
                "severe_low", "< " + ReportFormat.fmt2(number(bandsCfg.get("severe_low"), 0.90)) + " pu",
                "violation_low", ReportFormat.fmt2(number(bandsCfg.get("severe_low"), 0.90)) + "–"
                        + ReportFormat.fmt2(number(bandsCfg.get("violation_low"), 0.95)) + " pu",
                "marginal", ReportFormat.fmt2(number(bandsCfg.get("violation_low"), 0.95)) + "–"
                        + ReportFormat.fmt2(number(bandsCfg.get("marginal_low"), 0.98)) + " pu",
                "nominal", ReportFormat.fmt2(number(bandsCfg.get("marginal_low"), 0.98)) + "–"
                        + ReportFormat.fmt2(number(bandsCfg.get("marginal_high"), 1.02)) + " pu",
                "high_ok", ReportFormat.fmt2(number(bandsCfg.get("marginal_high"), 1.02)) + "–"
                        + ReportFormat.fmt2(number(bandsCfg.get("violation_high"), 1.05)) + " pu",
                "violation_high", "> " + ReportFormat.fmt2(number(bandsCfg.get("violation_high"), 1.05)) + " pu");
        Map<String, String> bandLabels = Map.of(
                "severe_low", "Severe Low (below planning limit)",
                "violation_low", "Low Violation (below planning limit)",
                "marginal", "Marginal Low",
                "nominal", "Nominal",
                "high_ok", "High Acceptable",
                "violation_high", "High Violation (above planning limit)");

        for (String bandKey : List.of("severe_low", "violation_low", "marginal", "nominal", "high_ok", "violation_high")) {
            int count = voltage.bands().getOrDefault(bandKey, List.of()).size();
            double pct = voltage.busesAnalyzed() > 0 ? count * 100.0 / voltage.busesAnalyzed() : 0;
            if (count > 0 || "marginal".equals(bandKey) || "nominal".equals(bandKey)) {
                report.add(MarkdownTable.row(
                        bandDescriptions.get(bandKey),
                        bandLabels.get(bandKey),
                        String.valueOf(count),
                        ReportFormat.pct1(pct)));
            }
        }
        report.add("");
    }

    private static void appendViolationTables(
            List<String> report,
            VoltageAnalyzer.VoltageProfileResult voltage,
            double vMinLimit,
            double vMaxLimit,
            double vMargLow,
            ReportConfig cfg) {
        if (!voltage.violationsLow().isEmpty()) {
            report.add("### Buses Below " + ReportFormat.fmt2(vMinLimit) + " pu — "
                    + voltage.violationsLow().size() + " Buses");
            report.add("");
            report.add(MarkdownTable.row("Bus", "Name", "Voltage (pu)"));
            report.add(MarkdownTable.separator(3));
            for (VoltageAnalyzer.Violation v : voltage.violationsLow()) {
                report.add(MarkdownTable.row("Bus" + v.busId(), v.name(), "**" + ReportFormat.fmt4(v.voltage()) + "**"));
            }
            report.add("");
        }

        if (!voltage.violationsHigh().isEmpty()) {
            report.add("### Buses Above " + ReportFormat.fmt2(vMaxLimit) + " pu — "
                    + voltage.violationsHigh().size() + " Buses");
            report.add("");
            report.add(MarkdownTable.row("Bus", "Name", "Voltage (pu)"));
            report.add(MarkdownTable.separator(3));
            for (VoltageAnalyzer.Violation v : voltage.violationsHigh()) {
                report.add(MarkdownTable.row("Bus" + v.busId(), v.name(), ReportFormat.fmt4(v.voltage())));
            }
            report.add("");
        }

        if (!voltage.lowVoltageWarn().isEmpty()) {
            List<VoltageAnalyzer.Violation> warn = voltage.lowVoltageWarn();
            List<Double> vals = warn.stream().map(VoltageAnalyzer.Violation::voltage).sorted().toList();
            double vMinM = vals.get(0);
            double vMaxM = vals.get(vals.size() - 1);
            double vMean = vals.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            double vMed = median(vals);

            report.add("### Marginal Low Voltage (" + ReportFormat.fmt2(vMinLimit) + "–"
                    + ReportFormat.fmt2(vMargLow) + " pu) — " + warn.size() + " Buses");
            report.add("");
            report.add("These buses are within the " + ReportFormat.fmt2(vMinLimit) + "–"
                    + ReportFormat.fmt2(vMaxLimit) + " pu band but below "
                    + ReportFormat.fmt2(vMargLow) + " pu. Per-bus listing is omitted for large cases.");
            report.add("");
            report.add(MarkdownTable.row("Metric", "Value"));
            report.add(MarkdownTable.separator(2));
            report.add(MarkdownTable.row("Buses in band", String.valueOf(warn.size())));
            report.add(MarkdownTable.row("Minimum V", ReportFormat.fmt4(vMinM) + " pu"));
            report.add(MarkdownTable.row("Median V", ReportFormat.fmt4(vMed) + " pu"));
            report.add(MarkdownTable.row("Mean V", ReportFormat.fmt4(vMean) + " pu"));
            report.add(MarkdownTable.row("Maximum V", ReportFormat.fmt4(vMaxM) + " pu"));
            report.add("");
            int nSample = cfg.displayInt("marginal_sample_count", 10);
            report.add("**Lowest " + nSample + " buses by voltage (sample):**");
            report.add("");
            report.add(MarkdownTable.row("Bus", "Name", "V (pu)"));
            report.add(MarkdownTable.separator(3));
            warn.stream().sorted(Comparator.comparingDouble(VoltageAnalyzer.Violation::voltage)).limit(nSample)
                    .forEach(v -> report.add(MarkdownTable.row(
                            "Bus" + v.busId(), v.name(), ReportFormat.fmt4(v.voltage()))));
            report.add("");
        }
    }

    private static void appendBranchLoading(
            List<String> report,
            ReportConfig cfg,
            BranchLoadingAnalyzer.BranchLoadingResult branchLoad) {
        report.add("## Branch Thermal Loading");
        report.add("");

        if (!branchLoad.hasRatings()) {
            report.add("> **Note:** Branch MVA ratings (`LimMvaA`) are not populated for any of the **"
                    + branchLoad.totalBranches() + " branches** in this dataset. Thermal loading "
                    + "percentages cannot be computed. Populate `LimMvaA` in the source case and rerun "
                    + "ACLF to enable this section.");
            report.add("");
            return;
        }

        report.add("Branches with Rate A ratings: **" + branchLoad.branchesWithRatings() + "/"
                + branchLoad.totalBranches() + "**.");
        report.add("");

        double overloadPct = cfg.dbl("thermal", "overload_pct", 100);
        double heavyPct = cfg.dbl("thermal", "heavy_pct", 80);
        double moderatePct = cfg.dbl("thermal", "moderate_pct", 50);

        if (!branchLoad.overloaded().isEmpty()) {
            report.add("### Overloaded Circuits (>" + ReportFormat.fmt0(overloadPct)
                    + "% Rate A) — " + branchLoad.overloaded().size() + " Circuits");
            report.add("");
            report.add(MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"));
            report.add(MarkdownTable.separator(5));
            for (BranchLoadingAnalyzer.BranchFlow bf : branchLoad.overloaded()) {
                report.add(MarkdownTable.row(
                        bf.name(), bf.from() + " → " + bf.to(),
                        "**" + ReportFormat.fmt1(bf.sMva()) + "**",
                        ReportFormat.fmt1(bf.ratingMva()), "**" + ReportFormat.fmt1(bf.loadingPct()) + "**"));
            }
            report.add("");
        }

        appendLoadedBranchSection(report, cfg, branchLoad.heavilyLoaded(), heavyPct, overloadPct, true);
        appendModerateBranchSection(report, cfg, branchLoad.moderateLoaded(), moderatePct, heavyPct);

        report.add("### Top 5 Loaded Circuits");
        report.add("");
        report.add(MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"));
        report.add(MarkdownTable.separator(5));
        for (BranchLoadingAnalyzer.BranchFlow bf : branchLoad.top5()) {
            String ratingCell = bf.ratingMva() != null ? ReportFormat.fmt1(bf.ratingMva()) : "—";
            report.add(MarkdownTable.row(
                    bf.name(), bf.from() + " → " + bf.to(),
                    ReportFormat.fmt1(bf.sMva()), ratingCell, ReportFormat.fmt1(bf.loadingPct())));
        }
        report.add("");
        report.add("**Rate A Loading Within Limits:** "
                + MarkdownTable.statusBadge(branchLoad.overloaded().isEmpty()));
        report.add("");

        if (branchLoad.hasRatingsB()) {
            appendRateBSummary(report, branchLoad);
        }
    }

    private static void appendLoadedBranchSection(
            List<String> report,
            ReportConfig cfg,
            List<BranchLoadingAnalyzer.BranchFlow> branches,
            double lowPct,
            double highPct,
            boolean heavilyLoaded) {
        if (branches.isEmpty()) {
            return;
        }
        String title = heavilyLoaded ? "Heavily Loaded Branches" : "Moderately Loaded Branches";
        report.add("### " + title + " (" + ReportFormat.fmt0(lowPct) + "–" + ReportFormat.fmt0(highPct)
                + "%) — " + branches.size() + " Circuits");
        report.add("");
        report.add(MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"));
        report.add(MarkdownTable.separator(5));
        int maxDisplay = heavilyLoaded
                ? cfg.displayInt("max_heavily_loaded", 10)
                : cfg.displayInt("max_moderate_loaded", 10);
        branches.stream().limit(maxDisplay).forEach(bf -> report.add(MarkdownTable.row(
                bf.name(), bf.from() + " → " + bf.to(),
                ReportFormat.fmt1(bf.sMva()),
                ReportFormat.fmt1(bf.ratingMva()),
                ReportFormat.fmt1(bf.loadingPct()))));
        if (branches.size() > maxDisplay) {
            report.add("*... and " + (branches.size() - maxDisplay) + " more circuits*");
        }
        report.add("");
    }

    private static void appendModerateBranchSection(
            List<String> report,
            ReportConfig cfg,
            List<BranchLoadingAnalyzer.BranchFlow> branches,
            double moderatePct,
            double heavyPct) {
        if (branches.isEmpty()) {
            return;
        }
        report.add("### Moderately Loaded Branches (" + ReportFormat.fmt0(moderatePct) + "–"
                + ReportFormat.fmt0(heavyPct) + "%) — " + branches.size() + " Circuits");
        report.add("");
        report.add(MarkdownTable.row("Branch", "From–To", "Flow (MVA)", "Loading %"));
        report.add(MarkdownTable.separator(4));
        int maxDisplay = cfg.displayInt("max_moderate_loaded", 10);
        branches.stream().limit(maxDisplay).forEach(bf -> report.add(MarkdownTable.row(
                bf.name(), bf.from() + " → " + bf.to(),
                ReportFormat.fmt1(bf.sMva()), ReportFormat.fmt1(bf.loadingPct()))));
        if (branches.size() > maxDisplay) {
            report.add("*... and " + (branches.size() - maxDisplay) + " more circuits*");
        }
        report.add("");
    }

    private static void appendRateBSummary(
            List<String> report,
            BranchLoadingAnalyzer.BranchLoadingResult branchLoad) {
        List<BranchLoadingAnalyzer.BranchFlow> overloadedB = branchLoad.overloadedB();
        List<BranchLoadingAnalyzer.BranchFlow> heavyB = branchLoad.heavyLoadedB();
        if (overloadedB.isEmpty() && heavyB.isEmpty()) {
            return;
        }
        report.add("### Rate B (Emergency) Loading Summary");
        report.add("");
        if (!overloadedB.isEmpty()) {
            report.add("- **" + overloadedB.size() + " circuits** exceed 100% of Rate B in this base case");
        }
        if (!heavyB.isEmpty()) {
            report.add("- **" + heavyB.size() + " circuits** operate above 80% of Rate B in this base case");
        }
        report.add("");
        if (!overloadedB.isEmpty()) {
            report.add(MarkdownTable.row("Branch", "From–To", "Rate A Loading %", "Rate B Loading %",
                    "Rate B Rating (MVA)"));
            report.add(MarkdownTable.separator(5));
            overloadedB.stream().limit(5).forEach(bf -> report.add(MarkdownTable.row(
                    bf.name(), bf.from() + " → " + bf.to(),
                    ReportFormat.fmt1(bf.loadingPct()),
                    "**" + ReportFormat.fmt1(bf.loadingPctB()) + "**",
                    ReportFormat.fmt1(bf.ratingMvaB()))));
            report.add("");
        }
    }

    private static void appendGeneratorQ(
            List<String> report,
            ReportConfig cfg,
            GeneratorQAnalyzer.GeneratorQResult genQ) {
        report.add("## Generator Reactive Power");
        report.add("");
        boolean qPass = genQ.violations().isEmpty();
        report.add("**Generators Within Q-Limits:** " + MarkdownTable.statusBadge(qPass));
        report.add("");
        int nGens = genQ.totalGens();
        int nAtLimit = genQ.atLimit().size();
        int nViol = genQ.violations().size();
        double qLimitPct = nGens > 0 ? nAtLimit * 100.0 / nGens : 0;
        double qViolPct = nGens > 0 ? nViol * 100.0 / nGens : 0;
        report.add(MarkdownTable.row("Metric", "Value"));
        report.add(MarkdownTable.separator(2));
        report.add(MarkdownTable.row("Generators Considered", nGens));
        report.add(MarkdownTable.row("At Q-Limit", nAtLimit + " (" + ReportFormat.pct1(qLimitPct) + ")"));
        report.add(MarkdownTable.row("Q-Limit Violations", nViol + " (" + ReportFormat.pct1(qViolPct) + ")"));
        report.add("");

        if (!genQ.violations().isEmpty()) {
            report.add("### Q-Limit Violations — " + nViol + " Violations");
            report.add("");
            report.add(MarkdownTable.row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)"));
            report.add(MarkdownTable.separator(5));
            for (GeneratorQAnalyzer.QViolation v : genQ.violations()) {
                report.add(MarkdownTable.row("Bus" + v.bus(), v.name(),
                        ReportFormat.fmt4(v.q()), ReportFormat.fmt4(v.qmax()), ReportFormat.fmt4(v.qmin())));
            }
            report.add("");
        }

        if (!genQ.atLimit().isEmpty()) {
            int maxDisplayQ = cfg.displayInt("max_q_limit", 20);
            double qMargin = cfg.dbl("generator", "q_at_limit_margin", 0.015);
            report.add("### Generators at Q-Limit — " + nAtLimit + " Units");
            report.add("");
            report.add(MarkdownTable.row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)", "At Limit"));
            report.add(MarkdownTable.separator(6));
            genQ.atLimit().stream().limit(maxDisplayQ).forEach(g -> {
                String limitLabel = Math.abs(g.qmax() - g.q()) < qMargin ? "**Qmax**" : "**Qmin**";
                report.add(MarkdownTable.row("Bus" + g.bus(), g.name(),
                        ReportFormat.fmt4(g.q()), ReportFormat.fmt4(g.qmax()), ReportFormat.fmt4(g.qmin()),
                        limitLabel));
            });
            if (nAtLimit > maxDisplayQ) {
                report.add("");
                report.add("*... and " + (nAtLimit - maxDisplayQ) + " more units at limit*");
            }
            report.add("");
            report.add("> **Note:** Generators at their reactive power limit have been switched from "
                    + "PV to PQ during the load flow solution, reducing local voltage regulation capability.");
            report.add("");
        }
    }

    private static void appendFooter(
            List<String> report,
            String displayName,
            ProjectPaths paths,
            Path caseBase,
            String prefix) {
        Path wspace = paths.wspaceDir().normalize().toAbsolutePath();
        String srcRel = wspace.relativize(caseBase.normalize().toAbsolutePath()).toString().replace('\\', '/');
        report.add("---");
        report.add("");
        report.add("## Report Metadata");
        report.add("");
        report.add(MarkdownTable.row("Field", "Value"));
        report.add(MarkdownTable.separator(2));
        report.add(MarkdownTable.row("Generated By", "`org.interpss.agent.report.AclfReportGenerator`"));
        report.add(MarkdownTable.row("Case", displayName));
        report.add(MarkdownTable.row("Source Data", "`" + srcRel + "/" + prefix + "_DF_*.csv`"));
        report.add(MarkdownTable.row("Network Info", "`" + srcRel + "/" + prefix + "_network_info.txt`"));
        report.add("");
        report.add("---");
        report.add("");
        report.add("> **End of AC Load Flow Report**");
    }

    private static double sumColumn(List<Map<String, String>> rows, String key) {
        return rows.stream().mapToDouble(r -> BusAnalysisUtil.parseDouble(r, key)).sum();
    }

    private static double genAtBus(List<Map<String, String>> gens, String busNum, String column) {
        return gens.stream()
                .filter(g -> busNum.equals(g.get("BusNumber")))
                .mapToDouble(g -> BusAnalysisUtil.parseDouble(g, column))
                .findFirst()
                .orElse(0);
    }

    private static double median(List<Double> vals) {
        int n = vals.size();
        int mid = n / 2;
        if (n % 2 == 1) {
            return vals.get(mid);
        }
        return (vals.get(mid - 1) + vals.get(mid)) / 2.0;
    }

    private static double number(Object value, double fallback) {
        return value instanceof Number n ? n.doubleValue() : fallback;
    }
}
