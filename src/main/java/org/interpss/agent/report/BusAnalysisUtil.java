package org.interpss.agent.report;

import java.util.List;
import java.util.Map;

public final class BusAnalysisUtil {

    private BusAnalysisUtil() {
    }

    public static boolean busInService(Map<String, String> bus) {
        String raw = bus.get("InService");
        if (raw == null || raw.strip().isEmpty()) {
            return true;
        }
        String normalized = raw.strip().toLowerCase();
        return normalized.equals("true") || normalized.equals("1") || normalized.equals("yes")
                || normalized.equals("y") || normalized.equals("t");
    }

    public static double parseDouble(Map<String, String> row, String key) {
        return Double.parseDouble(row.get(key));
    }

    public static String strip(Map<String, String> row, String key) {
        String value = row.get(key);
        return value == null ? "" : value.strip();
    }
}
