package org.interpss.agent.report;

public final class ReportFormat {

    private ReportFormat() {
    }

    public static String fmt0(double value) {
        return String.format("%.0f", value);
    }

    public static String fmt1(double value) {
        return String.format("%.1f", value);
    }

    public static String fmt2(double value) {
        return String.format("%.2f", value);
    }

    public static String fmt4(double value) {
        return String.format("%.4f", value);
    }

    public static String pct1(double value) {
        return String.format("%.1f%%", value);
    }
}
