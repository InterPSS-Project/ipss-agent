package org.interpss.agent.report;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class ContingencyAnalyzer {

    public record CriticalBranch(double s, String name, String from, String to) {
    }

    public record CriticalGen(double pg, String bus, String name, double pout) {
    }

    public record ContingencyCandidates(
            List<CriticalBranch> topBranches,
            List<CriticalGen> topGens) {
    }

    public record ContingencyOverload(
            String branch,
            String contingency,
            String outage,
            double baseFlow,
            double postFlow,
            double rating,
            double loadingPct) {
    }

    public record ContingencyResults(
            List<ContingencyOverload> overloads,
            List<ContingencyOverload> severeOverloads,
            int totalOverloads,
            int totalContingencies,
            int totalMonitored,
            boolean p1ThermalPass,
            List<ContingencyOverload> worst) {
    }

    private ContingencyAnalyzer() {
    }

    public static ContingencyCandidates analyzeCandidates(
            List<Map<String, String>> branches,
            List<Map<String, String>> gens,
            ReportConfig cfg) {
        double minGenOutput = cfg.dbl("generator", "min_gen_output_mw", 0.01);
        int maxElements = cfg.displayInt("max_critical_elements", 10);

        List<CriticalBranch> criticalBranches = new ArrayList<>();
        for (Map<String, String> br : branches) {
            double p = BusAnalysisUtil.parseDouble(br, "PFrom2To");
            double q = BusAnalysisUtil.parseDouble(br, "QFrom2To");
            double s = Math.sqrt(p * p + q * q);
            String brName = BusAnalysisUtil.strip(br, "Name");
            if (brName.isEmpty()) {
                brName = BusAnalysisUtil.strip(br, "ID");
            }
            criticalBranches.add(new CriticalBranch(
                    s, brName, BusAnalysisUtil.strip(br, "FromBusName"), BusAnalysisUtil.strip(br, "ToBusName")));
        }
        criticalBranches.sort(Comparator.comparingDouble(CriticalBranch::s).reversed());

        List<CriticalGen> criticalGens = new ArrayList<>();
        for (Map<String, String> gen : gens) {
            double pg = BusAnalysisUtil.parseDouble(gen, "PGen");
            if (Math.abs(pg) > minGenOutput) {
                criticalGens.add(new CriticalGen(
                        Math.abs(pg),
                        gen.get("BusNumber"),
                        BusAnalysisUtil.strip(gen, "BusName"),
                        pg));
            }
        }
        criticalGens.sort(Comparator.comparingDouble(CriticalGen::pg).reversed());

        return new ContingencyCandidates(
                criticalBranches.stream().limit(maxElements).toList(),
                criticalGens.stream().limit(maxElements).toList());
    }

    public static Map<List<String>, List<String>> identifyParallelCircuits(List<Map<String, String>> branches) {
        Map<List<String>, List<String>> pairs = new LinkedHashMap<>();
        for (Map<String, String> br : branches) {
            String fromId = br.get("FromBusNumber");
            String toId = br.get("ToBusNumber");
            List<String> key = sortedPair(fromId, toId);
            String brName = BusAnalysisUtil.strip(br, "Name");
            if (brName.isEmpty()) {
                brName = BusAnalysisUtil.strip(br, "ID");
            }
            pairs.computeIfAbsent(key, k -> new ArrayList<>()).add(brName);
        }

        Map<List<String>, List<String>> parallel = new LinkedHashMap<>();
        for (Map.Entry<List<String>, List<String>> entry : pairs.entrySet()) {
            if (entry.getValue().size() > 1) {
                parallel.put(entry.getKey(), entry.getValue());
            }
        }
        return parallel;
    }

    public static ContingencyResults analyzeResults(List<Map<String, String>> contingencyData, ReportConfig cfg) {
        if (contingencyData == null || contingencyData.isEmpty()) {
            return null;
        }

        double overloadPct = cfg.dbl("thermal", "overload_pct", 100);
        double severePct = cfg.dbl("thermal", "severe_pct", 120);

        List<ContingencyOverload> overloads = new ArrayList<>();
        List<ContingencyOverload> severeOverloads = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        for (Map<String, String> row : contingencyData) {
            double loading = BusAnalysisUtil.parseDouble(row, "LoadingPercent");
            String branchId = row.get("BranchID");
            String contingencyName = row.get("ContingencyName");
            String outageBranch = row.getOrDefault("OutageBranchName", "");
            if (outageBranch == null || outageBranch.isBlank()) {
                outageBranch = row.getOrDefault("OutageBranchId", "");
            }
            double baseFlow = BusAnalysisUtil.parseDouble(row, "BasecaseFlowMW");
            double postFlow = BusAnalysisUtil.parseDouble(row, "PostFlowMW");
            double rating = BusAnalysisUtil.parseDouble(row, "LineRatingMW");

            String key = branchId + "\0" + contingencyName;
            if (seen.contains(key)) {
                continue;
            }
            seen.add(key);

            if (loading > overloadPct) {
                ContingencyOverload entry = new ContingencyOverload(
                        branchId, contingencyName, outageBranch, baseFlow, postFlow, rating, loading);
                if (loading > severePct) {
                    severeOverloads.add(entry);
                } else {
                    overloads.add(entry);
                }
            }
        }

        overloads.sort(Comparator.comparingDouble(ContingencyOverload::loadingPct).reversed());
        severeOverloads.sort(Comparator.comparingDouble(ContingencyOverload::loadingPct).reversed());

        Set<String> contingencies = new HashSet<>();
        for (Map<String, String> row : contingencyData) {
            contingencies.add(row.get("ContingencyName"));
        }

        List<ContingencyOverload> worst = new ArrayList<>();
        worst.addAll(severeOverloads);
        worst.addAll(overloads);
        if (worst.size() > 10) {
            worst = worst.subList(0, 10);
        }

        return new ContingencyResults(
                overloads,
                severeOverloads,
                overloads.size() + severeOverloads.size(),
                contingencies.size(),
                contingencyData.size(),
                overloads.isEmpty() && severeOverloads.isEmpty(),
                worst);
    }

    private static List<String> sortedPair(String a, String b) {
        try {
            int ai = Integer.parseInt(a.strip());
            int bi = Integer.parseInt(b.strip());
            if (ai <= bi) {
                return List.of(a, b);
            }
            return List.of(b, a);
        } catch (NumberFormatException e) {
            return a.compareTo(b) <= 0 ? List.of(a, b) : List.of(b, a);
        }
    }
}
