package org.interpss.agent.report;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class VoltageAnalyzer {

    public record Violation(String busId, String name, double voltage) {
    }

    public record VoltageProfileResult(
            double vMin,
            double vMax,
            String vMinBus,
            String vMaxBus,
            List<Violation> violationsLow,
            List<Violation> violationsHigh,
            List<Violation> lowVoltageWarn,
            List<Violation> highVoltageWarn,
            Map<String, List<Violation>> bands,
            boolean passed,
            int inactiveExcluded,
            int busesAnalyzed) {
    }

    private VoltageAnalyzer() {
    }

    @SuppressWarnings("unchecked")
    public static VoltageProfileResult analyze(List<Map<String, String>> buses, ReportConfig cfg) {
        Map<String, Object> p0 = (Map<String, Object>) cfg.section("voltage").get("p0");
        Map<String, Object> bandsCfg = (Map<String, Object>) cfg.section("voltage").get("bands");

        double vMinLimit = number(p0.get("v_min"), 0.95);
        double vMaxLimit = number(p0.get("v_max"), 1.05);
        double vMargLow = number(p0.get("v_marginal_low"), 0.98);
        double vMargHigh = number(p0.get("v_marginal_high"), vMaxLimit);
        double fpTol = cfg.dbl("voltage", "fp_tol", 0.001);

        List<Map<String, String>> inService = buses.stream().filter(BusAnalysisUtil::busInService).toList();
        int inactiveExcluded = buses.size() - inService.size();

        Map<String, List<Violation>> bands = new LinkedHashMap<>();
        for (String key : List.of("severe_low", "violation_low", "marginal", "nominal", "high_ok", "violation_high")) {
            bands.put(key, new ArrayList<>());
        }

        if (inService.isEmpty()) {
            return new VoltageProfileResult(
                    1.0, 1.0,
                    "N/A (no in-service buses)",
                    "N/A (no in-service buses)",
                    List.of(), List.of(), List.of(), List.of(),
                    bands, true, inactiveExcluded, 0);
        }

        double vMin = Double.POSITIVE_INFINITY;
        double vMax = Double.NEGATIVE_INFINITY;
        String vMinBus = "";
        String vMaxBus = "";

        List<Violation> violationsLow = new ArrayList<>();
        List<Violation> violationsHigh = new ArrayList<>();
        List<Violation> lowVoltageWarn = new ArrayList<>();
        List<Violation> highVoltageWarn = new ArrayList<>();

        for (Map<String, String> bus : inService) {
            double v = BusAnalysisUtil.parseDouble(bus, "VoltMag");
            String name = BusAnalysisUtil.strip(bus, "Name");
            String bid = bus.get("Number");

            if (v < vMin) {
                vMin = v;
                vMinBus = "Bus" + bid + " (" + name + ")";
            }
            if (v > vMax) {
                vMax = v;
                vMaxBus = "Bus" + bid + " (" + name + ")";
            }

            if (v < vMinLimit - fpTol) {
                violationsLow.add(new Violation(bid, name, v));
            } else if (v < vMargLow) {
                lowVoltageWarn.add(new Violation(bid, name, v));
            } else if (v > vMaxLimit + fpTol) {
                violationsHigh.add(new Violation(bid, name, v));
            } else if (v > vMargHigh) {
                highVoltageWarn.add(new Violation(bid, name, v));
            }

            double sv = number(bandsCfg.get("severe_low"), 0.90);
            double vl = number(bandsCfg.get("violation_low"), vMinLimit);
            double ml = number(bandsCfg.get("marginal_low"), vMargLow);
            double mh = number(bandsCfg.get("marginal_high"), vMargHigh);
            double vh = number(bandsCfg.get("violation_high"), vMaxLimit);

            Violation entry = new Violation(bid, name, v);
            if (v < sv - fpTol) {
                bands.get("severe_low").add(entry);
            } else if (v < vl - fpTol) {
                bands.get("violation_low").add(entry);
            } else if (v < ml) {
                bands.get("marginal").add(entry);
            } else if (v <= mh) {
                bands.get("nominal").add(entry);
            } else if (v <= vh + fpTol) {
                bands.get("high_ok").add(entry);
            } else {
                bands.get("violation_high").add(entry);
            }
        }

        return new VoltageProfileResult(
                vMin, vMax, vMinBus, vMaxBus,
                violationsLow, violationsHigh, lowVoltageWarn, highVoltageWarn,
                bands,
                violationsLow.isEmpty() && violationsHigh.isEmpty(),
                inactiveExcluded,
                inService.size());
    }

    private static double number(Object value, double fallback) {
        return value instanceof Number n ? n.doubleValue() : fallback;
    }
}
