package org.interpss.agent.report;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class GeneratorQAnalyzer {

    public record QViolation(String bus, String name, double q, double qmax, double qmin, double margin) {
    }

    public record QAtLimit(String bus, String name, double q, double qmax, double qmin) {
    }

    public record GeneratorQResult(
            List<QViolation> violations,
            List<QAtLimit> atLimit,
            int totalGens) {
    }

    private GeneratorQAnalyzer() {
    }

    public static GeneratorQResult analyze(List<Map<String, String>> gens, ReportConfig cfg) {
        double atLimitMargin = cfg.dbl("generator", "q_at_limit_margin", 0.015);
        double fpTol = cfg.dbl("generator", "q_fp_tol", 0.001);

        List<QViolation> violations = new ArrayList<>();
        List<QAtLimit> atLimit = new ArrayList<>();
        int totalGens = 0;

        for (Map<String, String> gen : gens) {
            double q = BusAnalysisUtil.parseDouble(gen, "QGen");
            double qmax = BusAnalysisUtil.parseDouble(gen, "QMax");
            double qmin = BusAnalysisUtil.parseDouble(gen, "QMin");
            double p = BusAnalysisUtil.parseDouble(gen, "PGen");
            String bus = gen.get("BusNumber");
            String name = BusAnalysisUtil.strip(gen, "BusName");

            if (p == 0 && qmax == 0 && qmin == 0) {
                continue;
            }
            if (qmax == 0 && qmin == 0) {
                continue;
            }

            if (p != 0 || (qmax != 0 && qmin != 0)) {
                totalGens++;
            }

            double marginUpper = qmax - q;
            double marginLower = q - qmin;

            if ((q > qmax && q - qmax >= fpTol) || (q < qmin && qmin - q >= fpTol)) {
                violations.add(new QViolation(
                        bus, name, q, qmax, qmin,
                        q > qmax ? marginUpper : marginLower));
            } else if (Math.abs(marginUpper) < atLimitMargin
                    || Math.abs(marginLower) < atLimitMargin
                    || (q > qmax && q - qmax < fpTol)
                    || (q < qmin && qmin - q < fpTol)) {
                atLimit.add(new QAtLimit(bus, name, q, qmax, qmin));
            }
        }

        return new GeneratorQResult(violations, atLimit, totalGens);
    }
}
