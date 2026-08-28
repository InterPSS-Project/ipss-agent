package org.interpss.agent.report;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

/**
 * Report thresholds loaded from {@code config/gen_report.json} with Python-compatible defaults.
 */
public final class ReportConfig {

    private static final Gson GSON = new Gson();

    @SuppressWarnings("unchecked")
    private static final Map<String, Object> DEFAULTS = Map.of(
            "base_mva", 100_000,
            "voltage", Map.of(
                    "p0", Map.of(
                            "v_min", 0.95,
                            "v_max", 1.05,
                            "v_marginal_low", 0.98,
                            "v_marginal_high", 1.02),
                    "p1_p7", Map.of(
                            "v_min", 0.90,
                            "v_max", 1.05),
                    "bands", Map.of(
                            "severe_low", 0.90,
                            "violation_low", 0.95,
                            "marginal_low", 0.98,
                            "marginal_high", 1.02,
                            "violation_high", 1.05),
                    "fp_tol", 0.001),
            "thermal", Map.of(
                    "overload_pct", 100,
                    "heavy_pct", 80,
                    "moderate_pct", 50,
                    "severe_pct", 120),
            "generator", Map.of(
                    "q_at_limit_margin", 0.015,
                    "q_fp_tol", 0.001,
                    "min_gen_output_mw", 0.01),
            "display", new LinkedHashMap<>(Map.of(
                    "max_heavily_loaded", 10,
                    "max_moderate_loaded", 10,
                    "max_q_limit", 20,
                    "max_contingency_overloads", 20,
                    "max_critical_elements", 10,
                    "max_parallel_sample", 10,
                    "marginal_sample_count", 10)));

    private final Map<String, Object> cfg;

    private ReportConfig(Map<String, Object> cfg) {
        this.cfg = cfg;
    }

    public static ReportConfig load(Path projectRoot) throws IOException {
        Map<String, Object> merged = deepCopy(DEFAULTS);
        Path configPath = projectRoot.resolve("config").resolve("gen_report.json");
        if (Files.isRegularFile(configPath)) {
            try (Reader reader = Files.newBufferedReader(configPath)) {
                Map<String, Object> fromFile = GSON.fromJson(reader, new TypeToken<Map<String, Object>>() {
                }.getType());
                if (fromFile != null) {
                    deepUpdate(merged, fromFile);
                }
            }
        }
        return new ReportConfig(merged);
    }

    public int baseKva() {
        Object value = cfg.get("base_mva");
        if (value instanceof Number n) {
            return n.intValue();
        }
        return 100_000;
    }

    public double baseMva() {
        return baseKva() / 1000.0;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> section(String name) {
        Object value = cfg.get(name);
        if (value instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return Map.of();
    }

    public double dbl(String section, String key, double fallback) {
        Map<String, Object> sec = section(section);
        Object value = sec.get(key);
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        return fallback;
    }

    public int intVal(String section, String key, int fallback) {
        Map<String, Object> sec = section(section);
        Object value = sec.get(key);
        if (value instanceof Number n) {
            return n.intValue();
        }
        return fallback;
    }

    public int displayInt(String key, int fallback) {
        return intVal("display", key, fallback);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> deepCopy(Map<String, Object> source) {
        Map<String, Object> copy = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : source.entrySet()) {
            Object value = entry.getValue();
            if (value instanceof Map<?, ?> map) {
                copy.put(entry.getKey(), deepCopy((Map<String, Object>) map));
            } else {
                copy.put(entry.getKey(), value);
            }
        }
        return copy;
    }

    @SuppressWarnings("unchecked")
    private static void deepUpdate(Map<String, Object> base, Map<String, Object> override) {
        for (Map.Entry<String, Object> entry : override.entrySet()) {
            Object overrideValue = entry.getValue();
            Object baseValue = base.get(entry.getKey());
            if (overrideValue instanceof Map<?, ?> overrideMap
                    && baseValue instanceof Map<?, ?> baseMap) {
                deepUpdate((Map<String, Object>) baseMap, (Map<String, Object>) overrideMap);
            } else {
                base.put(entry.getKey(), overrideValue);
            }
        }
    }
}
