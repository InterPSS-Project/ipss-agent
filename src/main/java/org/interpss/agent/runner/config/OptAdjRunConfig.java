package org.interpss.agent.runner.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import com.google.gson.Gson;

/**
 * The per-case generator-redispatch (OptAdj) run configuration, persisted as
 * {@code config/opt_adj_run.json} under the case folder (the same directory as
 * {@code config/aclf_run.json} and {@code config/ca_run.json}).
 * <p>
 * The mode ({@code genAdjBaseCase} / {@code genAdjCA_N-1}) is <em>not</em> a config-file
 * key — the caller passes it to {@code OptAdjRunner} / the bridge. A leftover
 * {@code optAdjType} in an older file is ignored.
 *
 * <pre>
 * {
 *   "scanLoadingThreshold": 50,
 *   "optAdjLoadingThreshold": 100,
 *   "contingencyMode": "all" | "custom",
 *   "contingencyFile": "data/…/contingencies.json",
 *   "sparseSenMatrix": true,
 *   "threads": 0
 * }
 * </pre>
 *
 * The SSA scan uses a <em>lower</em> percentage (basecase 50 %, N-1 90 %) so the sparse
 * sensitivity matrix includes the near-limit branches, and the linear program then enforces the
 * OptAdj percentage (100 % of rating in both documented samples). Both thresholds are optional:
 * the scan default follows the caller's mode via {@link #scanLoadingThresholdOrDefault(String)},
 * and the other {@code …OrDefault()} accessors return what the samples used.
 * {@code sparseSenMatrix} selects the sparse (default) or dense sensitivity path in
 * {@code AclfNetLoadFlowOptimizer} / {@code AclfNetContigencyOptimizer}.
 * <p>
 * {@link #load} / {@link #fromJson} validate what they read — an unknown contingency mode, a
 * threshold outside {@code 0..1000}, a negative worker count or a {@code custom} contingency mode
 * with no file is rejected rather than silently defaulted, because a redispatch that quietly
 * ignores the requested limit is worse than one that says why it cannot run.
 */
public record OptAdjRunConfig(Double scanLoadingThreshold, Double optAdjLoadingThreshold,
        String contingencyMode, String contingencyFile, Boolean sparseSenMatrix, Integer threads) {

    public static final String GEN_ADJ_BASE_CASE = "genAdjBaseCase";
    public static final String GEN_ADJ_CA_N1 = "genAdjCA_N-1";

    /** The two documented modes, in the order the tool and the runner name them. */
    public static final List<String> TYPES = List.of(GEN_ADJ_BASE_CASE, GEN_ADJ_CA_N1);

    public static final String ALL = "all";
    public static final String CUSTOM = "custom";

    /** SSA scan threshold (%) of the basecase sample. */
    public static final double DEFAULT_SCAN_BASE_CASE = 50.0;
    /** SSA scan threshold (%) of the N-1 sample. */
    public static final double DEFAULT_SCAN_CA_N1 = 90.0;
    /** The loading (%) the optimizer enforces, in both samples. */
    public static final double DEFAULT_OPT_ADJ_THRESHOLD = 100.0;
    /** Sparse sensitivity matrix — what the documented samples and the runner used before the knob. */
    public static final boolean DEFAULT_SPARSE_SEN_MATRIX = true;
    /** {@code 0} = one SSA worker per available processor. */
    public static final int DEFAULT_THREADS = 0;

    /** Sample thresholds unset, sparse sensitivities, all N-1 outages, one worker per processor. */
    public static final OptAdjRunConfig DEFAULT = new OptAdjRunConfig(null, null, null, null, null, null);

    /**
     * The doc's two-argument form (the two thresholds), kept so the IEEE-39 samples in
     * {@code org.interpss.sample.optadj} stay short.
     */
    public OptAdjRunConfig(Double scanLoadingThreshold, Double optAdjLoadingThreshold) {
        this(scanLoadingThreshold, optAdjLoadingThreshold, ALL, null, null, DEFAULT_THREADS);
    }

    /** Read {@code configFile}; unknown keys are ignored and blank values become {@code null}. */
    public static OptAdjRunConfig load(Path configFile) throws IOException {
        return fromJson(Files.readString(configFile, StandardCharsets.UTF_8), configFile.toString());
    }

    /**
     * Parse and validate a config payload — the file's text, or the JSON the chat tool sends over
     * the bridge. {@code source} names the payload in every error message, a missing key stays
     * unset so the {@code …OrDefault()} accessors decide, and a blank payload is {@link #DEFAULT}.
     * A leftover {@code optAdjType} key is ignored (the mode is a runner argument).
     */
    public static OptAdjRunConfig fromJson(String json, String source) {
        OptAdjRunConfig raw = (json == null || json.isBlank())
                ? null
                : new Gson().fromJson(json, OptAdjRunConfig.class);
        if (raw == null) {
            return DEFAULT;
        }
        return new OptAdjRunConfig(
                CaRunConfig.loadingPercentage(raw.scanLoadingThreshold(), source, "scanLoadingThreshold"),
                CaRunConfig.loadingPercentage(raw.optAdjLoadingThreshold(), source, "optAdjLoadingThreshold"),
                CaRunConfig.mode(raw.contingencyMode(), source, "contingencyMode"),
                CaRunConfig.blankToNull(raw.contingencyFile()),
                raw.sparseSenMatrix(),
                CaRunConfig.count(raw.threads(), source, "threads"));
    }

    /**
     * Validate a caller-supplied mode token. Blank / null is the basecase redispatch; an unknown
     * token (including the retired {@code genAdjCaN_1} spelling) is rejected — the Host maps the
     * legacy name before it reaches Java.
     */
    public static String parseType(String optAdjType, String source) {
        if (optAdjType == null || optAdjType.isBlank()) {
            return GEN_ADJ_BASE_CASE;
        }
        String parsed = CaRunConfig.choice(optAdjType, TYPES, source, "optAdjType");
        return parsed == null ? GEN_ADJ_BASE_CASE : parsed;
    }

    /** Whether {@code optAdjType} is the N-1 mode (the already-resolved token from {@link #parseType}). */
    public static boolean isCaN1(String optAdjType) {
        return GEN_ADJ_CA_N1.equals(optAdjType);
    }

    /**
     * The candidate-collection percentage; unset follows the mode (50 % basecase, 90 % N-1).
     * {@code optAdjType} is the resolved mode from {@link #parseType}.
     */
    public double scanLoadingThresholdOrDefault(String optAdjType) {
        if (scanLoadingThreshold != null) {
            return scanLoadingThreshold;
        }
        return isCaN1(optAdjType) ? DEFAULT_SCAN_CA_N1 : DEFAULT_SCAN_BASE_CASE;
    }

    /** The percentage the optimizer enforces; unset is the samples' 100 %. */
    public double optAdjLoadingThresholdOrDefault() {
        return optAdjLoadingThreshold == null ? DEFAULT_OPT_ADJ_THRESHOLD : optAdjLoadingThreshold;
    }

    /** Sparse ({@code true}) or dense sensitivity matrix; unset is the samples' sparse path. */
    public boolean sparseSenMatrixOrDefault() {
        return sparseSenMatrix == null ? DEFAULT_SPARSE_SEN_MATRIX : sparseSenMatrix;
    }

    /** SSA worker count; {@code 0} means one per available processor. */
    public int threadsOrDefault() {
        return threads == null ? DEFAULT_THREADS : threads;
    }

    public boolean contingencyIsCustom() {
        return CUSTOM.equals(contingencyMode);
    }

    /** The contingency file the mode names, or {@code null} when the N-1 default applies. */
    public String contingencyInput() {
        return contingencyIsCustom() ? contingencyFile : null;
    }

    /** This config with the scan percentage replaced (the tool's per-call override). */
    public OptAdjRunConfig withScanLoadingThreshold(double value) {
        return new OptAdjRunConfig(value, optAdjLoadingThreshold,
                contingencyMode, contingencyFile, sparseSenMatrix, threads);
    }
}
