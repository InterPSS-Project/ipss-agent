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
 *
 * <pre>
 * {
 *   "optAdjType": "genAdjBaseCase" | "genAdjCA_N-1",
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
 * the scan default follows {@code optAdjType}, and {@code …OrDefault()} returns what the samples
 * used. {@code sparseSenMatrix} selects the sparse (default) or dense sensitivity path in
 * {@code AclfNetLoadFlowOptimizer} / {@code AclfNetContigencyOptimizer}.
 * <p>
 * {@link #load} / {@link #fromJson} validate what they read — an unknown mode token, a threshold
 * outside {@code 0..1000}, a negative worker count or a {@code custom} contingency mode with no
 * file is rejected rather than silently defaulted, because a redispatch that quietly ignores the
 * requested mode or limit is worse than one that says why it cannot run.
 */
public record OptAdjRunConfig(String optAdjType, Double scanLoadingThreshold, Double optAdjLoadingThreshold,
        String contingencyMode, String contingencyFile, Boolean sparseSenMatrix, Integer threads) {

    public static final String GEN_ADJ_BASE_CASE = "genAdjBaseCase";
    public static final String GEN_ADJ_CA_N1 = "genAdjCA_N-1";

    /** The two documented modes, in the order the tool and the config file name them. */
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

    /** Basecase mode, sample thresholds, sparse sensitivities, all N-1 outages, one worker per processor. */
    public static final OptAdjRunConfig DEFAULT = new OptAdjRunConfig(null, null, null, null, null, null, null);

    /**
     * The doc's three-argument form (mode plus the two thresholds), kept so the
     * IEEE-39 samples in {@code org.interpss.sample.optadj} compile unchanged.
     */
    public OptAdjRunConfig(String optAdjType, Double scanLoadingThreshold, Double optAdjLoadingThreshold) {
        this(optAdjType, scanLoadingThreshold, optAdjLoadingThreshold, ALL, null, null, DEFAULT_THREADS);
    }

    /** Read {@code configFile}; unknown keys are ignored and blank values become {@code null}. */
    public static OptAdjRunConfig load(Path configFile) throws IOException {
        return fromJson(Files.readString(configFile, StandardCharsets.UTF_8), configFile.toString());
    }

    /**
     * Parse and validate a config payload — the file's text, or the JSON the chat tool sends over
     * the bridge. {@code source} names the payload in every error message, a missing key stays
     * unset so the {@code …OrDefault()} accessors decide, and a blank payload is {@link #DEFAULT}.
     */
    public static OptAdjRunConfig fromJson(String json, String source) {
        OptAdjRunConfig raw = (json == null || json.isBlank())
                ? null
                : new Gson().fromJson(json, OptAdjRunConfig.class);
        if (raw == null) {
            return DEFAULT;
        }
        return new OptAdjRunConfig(
                CaRunConfig.choice(raw.optAdjType(), TYPES, source, "optAdjType"),
                CaRunConfig.loadingPercentage(raw.scanLoadingThreshold(), source, "scanLoadingThreshold"),
                CaRunConfig.loadingPercentage(raw.optAdjLoadingThreshold(), source, "optAdjLoadingThreshold"),
                CaRunConfig.mode(raw.contingencyMode(), source, "contingencyMode"),
                CaRunConfig.blankToNull(raw.contingencyFile()),
                raw.sparseSenMatrix(),
                CaRunConfig.count(raw.threads(), source, "threads"));
    }

    /** The resolved mode; an unset one is the basecase redispatch. */
    public String optAdjTypeOrDefault() {
        return optAdjType == null ? GEN_ADJ_BASE_CASE : optAdjType;
    }

    public boolean isCaN1() {
        return GEN_ADJ_CA_N1.equals(optAdjTypeOrDefault());
    }

    /** The candidate-collection percentage; unset follows the mode (50 % basecase, 90 % N-1). */
    public double scanLoadingThresholdOrDefault() {
        if (scanLoadingThreshold != null) {
            return scanLoadingThreshold;
        }
        return isCaN1() ? DEFAULT_SCAN_CA_N1 : DEFAULT_SCAN_BASE_CASE;
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
        return new OptAdjRunConfig(optAdjType, value, optAdjLoadingThreshold,
                contingencyMode, contingencyFile, sparseSenMatrix, threads);
    }
}
