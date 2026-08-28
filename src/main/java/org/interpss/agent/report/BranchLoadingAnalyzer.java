package org.interpss.agent.report;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public final class BranchLoadingAnalyzer {

    public record BranchFlow(
            String name,
            String from,
            String to,
            String circuit,
            double pMw,
            double qMvar,
            double sMva,
            Double ratingMva,
            double loadingPct,
            Double ratingMvaB,
            double loadingPctB,
            Double ratingMvaC,
            double loadingPctC,
            boolean isXfmr) {
    }

    public record BranchLoadingResult(
            List<BranchFlow> top5,
            List<BranchFlow> heavilyLoaded,
            List<BranchFlow> overloaded,
            List<BranchFlow> moderateLoaded,
            List<BranchFlow> overloadedB,
            List<BranchFlow> heavyLoadedB,
            boolean hasRatings,
            boolean hasRatingsB,
            boolean hasRatingsC,
            int branchesWithRatings,
            int branchesWithRatingsB,
            int branchesWithRatingsC,
            int totalBranches,
            int totalTransformers,
            int totalLines) {
    }

    private BranchLoadingAnalyzer() {
    }

    public static BranchLoadingResult analyze(List<Map<String, String>> branches, ReportConfig cfg) {
        double overloadPct = cfg.dbl("thermal", "overload_pct", 100);
        double heavyPct = cfg.dbl("thermal", "heavy_pct", 80);
        double moderatePct = cfg.dbl("thermal", "moderate_pct", 50);
        double baseKva = cfg.baseKva();

        List<BranchFlow> branchFlows = new ArrayList<>();
        for (Map<String, String> br : branches) {
            double pFrom = BusAnalysisUtil.parseDouble(br, "PFrom2To");
            double qFrom = BusAnalysisUtil.parseDouble(br, "QFrom2To");
            double sMva = Math.sqrt(pFrom * pFrom + qFrom * qFrom);
            double ratingA = BusAnalysisUtil.parseDouble(br, "LimMvaA");
            double ratingB = parseOptionalDouble(br, "LimMvaB");
            double ratingC = parseOptionalDouble(br, "LimMvaC");
            boolean isXfmr = isTruthy(br.get("IsXfmr"));
            double ipssLoading = parseOptionalDouble(br, "Loading%");

            String brName = BusAnalysisUtil.strip(br, "Name");
            if (brName.isEmpty()) {
                brName = BusAnalysisUtil.strip(br, "ID");
            }

            Double ratingMva;
            double loadingPct;
            if (ratingA > 0) {
                if (ipssLoading > 0) {
                    ratingMva = sMva * baseKva / 1000 / (ipssLoading / 100);
                    loadingPct = ipssLoading;
                } else {
                    ratingMva = ratingA * baseKva / 1000;
                    loadingPct = ratingA > 0 ? sMva / ratingA * 100 : 0;
                }
            } else {
                ratingMva = null;
                loadingPct = ipssLoading == 0 ? 0 : ipssLoading;
            }

            double loadingPctB = ratingB > 0 ? sMva * baseKva / 1000 / ratingB * 100 : 0;
            double loadingPctC = ratingC > 0 ? sMva * baseKva / 1000 / ratingC * 100 : 0;

            branchFlows.add(new BranchFlow(
                    brName,
                    BusAnalysisUtil.strip(br, "FromBusName"),
                    BusAnalysisUtil.strip(br, "ToBusName"),
                    br.get("Circuit"),
                    pFrom * baseKva / 1000,
                    qFrom * baseKva / 1000,
                    sMva * baseKva / 1000,
                    ratingMva,
                    loadingPct,
                    ratingB > 0 ? ratingB : null,
                    loadingPctB,
                    ratingC > 0 ? ratingC : null,
                    loadingPctC,
                    isXfmr));
        }

        branchFlows.sort(Comparator.comparingDouble(
                (BranchFlow bf) -> bf.ratingMva() != null ? bf.loadingPct() : 0).reversed());

        List<BranchFlow> heavilyLoaded = new ArrayList<>();
        List<BranchFlow> overloaded = new ArrayList<>();
        List<BranchFlow> moderateLoaded = new ArrayList<>();
        List<BranchFlow> overloadedB = new ArrayList<>();
        List<BranchFlow> heavyLoadedB = new ArrayList<>();

        for (BranchFlow bf : branchFlows) {
            double pct = bf.loadingPct();
            if (pct > overloadPct) {
                overloaded.add(bf);
            } else if (pct > heavyPct) {
                heavilyLoaded.add(bf);
            } else if (pct > moderatePct) {
                moderateLoaded.add(bf);
            }

            if (pct > overloadPct && bf.ratingMvaB() != null) {
                overloadedB.add(bf);
            } else if (pct > heavyPct && bf.ratingMvaB() != null) {
                heavyLoadedB.add(bf);
            }
        }

        boolean hasRatings = branchFlows.stream().anyMatch(b -> b.ratingMva() != null && b.ratingMva() > 0);
        boolean hasRatingsB = branchFlows.stream().anyMatch(b -> b.ratingMvaB() != null);
        boolean hasRatingsC = branchFlows.stream().anyMatch(b -> b.ratingMvaC() != null);
        int nXfmr = (int) branchFlows.stream().filter(BranchFlow::isXfmr).count();

        return new BranchLoadingResult(
                branchFlows.stream().limit(5).toList(),
                heavilyLoaded,
                overloaded,
                moderateLoaded,
                overloadedB,
                heavyLoadedB,
                hasRatings,
                hasRatingsB,
                hasRatingsC,
                (int) branchFlows.stream().filter(b -> b.ratingMva() != null && b.ratingMva() > 0).count(),
                (int) branchFlows.stream().filter(b -> b.ratingMvaB() != null).count(),
                (int) branchFlows.stream().filter(b -> b.ratingMvaC() != null).count(),
                branchFlows.size(),
                nXfmr,
                branchFlows.size() - nXfmr);
    }

    private static double parseOptionalDouble(Map<String, String> row, String key) {
        String value = row.get(key);
        if (value == null || value.isBlank()) {
            return 0;
        }
        return Double.parseDouble(value);
    }

    private static boolean isTruthy(String raw) {
        if (raw == null) {
            return false;
        }
        String normalized = raw.strip().toLowerCase();
        return normalized.equals("true") || normalized.equals("1") || normalized.equals("yes")
                || normalized.equals("y") || normalized.equals("t");
    }
}
