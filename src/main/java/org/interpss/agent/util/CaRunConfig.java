package org.interpss.agent.util;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import com.google.gson.Gson;

/**
 * The per-case contingency-analysis run configuration, persisted as
 * {@code config/ca_run.json} under the case folder (the same directory as
 * {@code config/aclf_run.json}).
 * <p>
 * Both files are wspace-relative paths, matching the CLI's positional
 * {@code cont_file} / {@code monitor_file} arguments:
 *
 * <pre>
 * {
 *   "contingencyMode": "all" | "custom",
 *   "contingencyFile": "data/psse/Texas2K/2k_contingencies_115kVAbove.json",
 *   "monitorMode": "all" | "custom",
 *   "monitoredBranchFile": "data/psse/Texas2K/2k_monitored_branches.json",
 *   "overloadThreshold": 90
 * }
 * </pre>
 *
 * A missing key defaults to {@link #ALL} with no file, and a missing
 * {@code overloadThreshold} to {@link #DEFAULT_OVERLOAD_THRESHOLD}. The
 * threshold is the violation-check loading percentage the dialog shows: a
 * monitored branch whose post-contingency loading reaches it is reported. Unlike
 * {@code aclf_run.json} there is no project-level default: contingency and
 * monitored-branch lists are case-specific, so an absent {@code ca_run.json}
 * falls through to the runner's built-in defaults (all N-1 outages, all
 * branches monitored).
 */
public record CaRunConfig(String contingencyMode, String contingencyFile,
        String monitorMode, String monitoredBranchFile, Double overloadThreshold) {

    public static final String ALL = "all";
    public static final String CUSTOM = "custom";

    /** Violation-check loading (%) used when the file does not set one. */
    public static final double DEFAULT_OVERLOAD_THRESHOLD = 90.0;

    /** All N-1 contingencies / monitor every branch / 90% threshold. */
    public static final CaRunConfig DEFAULT = new CaRunConfig(ALL, null, ALL, null, null);

    /**
     * Read {@code configFile}. Unknown keys are ignored, blank values become
     * {@code null}, and a mode other than {@code all}/{@code custom} is
     * rejected rather than silently treated as a default.
     */
    public static CaRunConfig load(Path configFile) throws IOException {
        CaRunConfig raw = new Gson().fromJson(
                Files.readString(configFile, StandardCharsets.UTF_8), CaRunConfig.class);
        if (raw == null) {
            return DEFAULT;
        }
        return new CaRunConfig(
                mode(raw.contingencyMode(), configFile, "contingencyMode"),
                blankToNull(raw.contingencyFile()),
                mode(raw.monitorMode(), configFile, "monitorMode"),
                blankToNull(raw.monitoredBranchFile()),
                threshold(raw.overloadThreshold(), configFile));
    }

    public boolean contingencyIsCustom() {
        return CUSTOM.equals(contingencyMode);
    }

    public boolean monitorIsCustom() {
        return CUSTOM.equals(monitorMode);
    }

    /** The file the contingency mode names, or {@code null} when unused. */
    public String contingencyInput() {
        return contingencyIsCustom() ? contingencyFile : null;
    }

    /** The file the monitor mode names, or {@code null} when unused. */
    public String monitoredBranchInput() {
        return monitorIsCustom() ? monitoredBranchFile : null;
    }

    private static String mode(String value, Path configFile, String key) {
        if (value == null || value.isBlank()) {
            return ALL;
        }
        String normalized = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (!normalized.equals(ALL) && !normalized.equals(CUSTOM)) {
            throw new IllegalStateException(configFile + ": unsupported " + key + " '" + value
                    + "' (expected " + ALL + "|" + CUSTOM + ")");
        }
        return normalized;
    }

    /** The configured violation-check loading (%), or the default when unset. */
    public double overloadThresholdOrDefault() {
        return overloadThreshold == null ? DEFAULT_OVERLOAD_THRESHOLD : overloadThreshold;
    }

    /** Reject a threshold the runner could not honour rather than silently defaulting. */
    private static Double threshold(Double value, Path configFile) {
        if (value == null) {
            return null;
        }
        if (!Double.isFinite(value) || value <= 0.0 || value > 1000.0) {
            throw new IllegalStateException(configFile
                    + ": overloadThreshold must be a loading percentage between 0 and 1000, got " + value);
        }
        return value;
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }
}
