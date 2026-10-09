package org.interpss.agent.util;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

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
 *   "overloadThreshold": 90,
 *   "dclfInclLoss": true,
 *   "dclfScreening": false,
 *   "dcLoadingCutoff": 100,
 *   "dcFlowChangeCutoff": 200,
 *   "solutionMethod": "SparseEqnSolve" | "WoodburyMatrixUpdate",
 *   "kluEndpointRhsBatchSize": 0,
 *   "cacheViolationCombinedShiftFactors": false,
 *   "islandingTreatment": "SKIP" | "ANCHORED_COMPENSATE_ONE_BUS" | "FULL_DCLF_REPLAY",
 *   "n1IslandingReplayEnabled": false,
 *   "multiOutageReplayMode": "EXACT_TOPOLOGY" | "HIGH_IMPEDANCE",
 *   "highImpedanceReactancePu": 10000,
 *   "turnOffIslandBus": true,
 *   "autoTurnLine2Xfr": true,
 *   "ratingProvider": "default" | "RATING_A" | "RATING_B",
 *   "threads": 0
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
 * <p>
 * The keys from {@code dclfInclLoss} on are the solver knobs of
 * {@code com.interpss.core.algo.dclf.DclfContingencyConfig} (plus the runner's
 * worker count). Every one of them is optional and the {@code …OrDefault()}
 * accessors below return the value the runner used before they were exposed, so
 * a config file that names none of them behaves exactly as it always did.
 * {@link #load} validates them — an unknown enum value, a negative count or a
 * cutoff outside {@code 0..1000} is rejected rather than silently defaulted,
 * because a run that quietly ignores what the dialog selected is worse than one
 * that says why it cannot.
 */
public record CaRunConfig(String contingencyMode, String contingencyFile,
        String monitorMode, String monitoredBranchFile, Double overloadThreshold,
        Boolean dclfInclLoss, Boolean dclfScreening, Double dcLoadingCutoff, Double dcFlowChangeCutoff,
        String solutionMethod, Integer kluEndpointRhsBatchSize, Boolean cacheViolationCombinedShiftFactors,
        String islandingTreatment, Boolean n1IslandingReplayEnabled, String multiOutageReplayMode,
        Double highImpedanceReactancePu, Boolean turnOffIslandBus, Boolean autoTurnLine2Xfr,
        String ratingProvider, Integer threads) {

    public static final String ALL = "all";
    public static final String CUSTOM = "custom";

    /** Violation-check loading (%) used when the file does not set one. */
    public static final double DEFAULT_OVERLOAD_THRESHOLD = 90.0;

    /** {@code DclfContingencyConfig} defaults, as measured on ipss.core.lib 1.4.0. */
    public static final boolean DEFAULT_DCLF_INCL_LOSS = true;
    public static final boolean DEFAULT_DCLF_SCREENING = false;
    public static final double DEFAULT_DC_LOADING_CUTOFF = 100.0;
    public static final double DEFAULT_DC_FLOW_CHANGE_CUTOFF = 200.0;
    public static final boolean DEFAULT_CACHE_VIOLATION_SHIFT_FACTORS = false;
    public static final boolean DEFAULT_N1_ISLANDING_REPLAY = false;
    public static final double DEFAULT_HIGH_IMPEDANCE_REACTANCE_PU = 10000.0;
    public static final boolean DEFAULT_TURN_OFF_ISLAND_BUS = true;
    public static final boolean DEFAULT_AUTO_TURN_LINE2XFR = true;

    /**
     * The library's own branch-rating provider. Measured on ipss.core.lib 1.4.0 this is
     * {@code BranchRatingProvider.RATING_B} (rating MVA 2); {@code RATING_A} is the other,
     * lower-rating choice and reports more overloads.
     */
    public static final String DEFAULT_RATING_PROVIDER = "default";
    /** {@code 0} = one worker per available processor, the runner's historical choice. */
    public static final int DEFAULT_THREADS = 0;

    public static final List<String> SOLUTION_METHODS =
            List.of("SparseEqnSolve", "WoodburyMatrixUpdate");
    public static final List<String> ISLANDING_TREATMENTS =
            List.of("SKIP", "ANCHORED_COMPENSATE_ONE_BUS", "FULL_DCLF_REPLAY");
    public static final List<String> MULTI_OUTAGE_REPLAY_MODES =
            List.of("EXACT_TOPOLOGY", "HIGH_IMPEDANCE");
    public static final List<String> RATING_PROVIDERS =
            List.of(DEFAULT_RATING_PROVIDER, "RATING_A", "RATING_B");

    /** All N-1 contingencies / monitor every branch / 90% threshold / solver defaults. */
    public static final CaRunConfig DEFAULT = new CaRunConfig(ALL, null, ALL, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);

    /**
     * Read {@code configFile}. Unknown keys are ignored, blank values become
     * {@code null}, and a mode other than {@code all}/{@code custom} — or any
     * other unusable solver knob — is rejected rather than silently treated as a
     * default.
     */
    public static CaRunConfig load(Path configFile) throws IOException {
        return fromJson(Files.readString(configFile, StandardCharsets.UTF_8), configFile.toString());
    }

    /**
     * Parse and validate a config payload — the file's text, or the JSON the tab's
     * CA dialog / the chat tool sends over the bridge. {@code source} names the
     * payload in every error message. Missing keys stay unset so the
     * {@code …OrDefault()} accessors decide, and a blank payload is
     * {@link #DEFAULT}.
     */
    public static CaRunConfig fromJson(String json, String source) {
        CaRunConfig raw = (json == null || json.isBlank())
                ? null
                : new Gson().fromJson(json, CaRunConfig.class);
        if (raw == null) {
            return DEFAULT;
        }
        return new CaRunConfig(
                mode(raw.contingencyMode(), source, "contingencyMode"),
                blankToNull(raw.contingencyFile()),
                mode(raw.monitorMode(), source, "monitorMode"),
                blankToNull(raw.monitoredBranchFile()),
                threshold(raw.overloadThreshold(), source),
                raw.dclfInclLoss(),
                raw.dclfScreening(),
                cutoff(raw.dcLoadingCutoff(), source, "dcLoadingCutoff"),
                cutoff(raw.dcFlowChangeCutoff(), source, "dcFlowChangeCutoff"),
                choice(raw.solutionMethod(), SOLUTION_METHODS, source, "solutionMethod"),
                count(raw.kluEndpointRhsBatchSize(), source, "kluEndpointRhsBatchSize"),
                raw.cacheViolationCombinedShiftFactors(),
                choice(raw.islandingTreatment(), ISLANDING_TREATMENTS, source, "islandingTreatment"),
                raw.n1IslandingReplayEnabled(),
                choice(raw.multiOutageReplayMode(), MULTI_OUTAGE_REPLAY_MODES, source, "multiOutageReplayMode"),
                positive(raw.highImpedanceReactancePu(), source, "highImpedanceReactancePu"),
                raw.turnOffIslandBus(),
                raw.autoTurnLine2Xfr(),
                choice(raw.ratingProvider(), RATING_PROVIDERS, source, "ratingProvider"),
                count(raw.threads(), source, "threads"));
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

    /** The configured violation-check loading (%), or the default when unset. */
    public double overloadThresholdOrDefault() {
        return overloadThreshold == null ? DEFAULT_OVERLOAD_THRESHOLD : overloadThreshold;
    }

    /** This config with the violation-check loading replaced (the tool's per-call override). */
    public CaRunConfig withOverloadThreshold(double value) {
        return new CaRunConfig(contingencyMode, contingencyFile, monitorMode, monitoredBranchFile, value,
                dclfInclLoss, dclfScreening, dcLoadingCutoff, dcFlowChangeCutoff, solutionMethod,
                kluEndpointRhsBatchSize, cacheViolationCombinedShiftFactors, islandingTreatment,
                n1IslandingReplayEnabled, multiOutageReplayMode, highImpedanceReactancePu, turnOffIslandBus,
                autoTurnLine2Xfr, ratingProvider, threads);
    }

    public boolean dclfInclLossOrDefault() {
        return dclfInclLoss == null ? DEFAULT_DCLF_INCL_LOSS : dclfInclLoss;
    }

    public boolean dclfScreeningOrDefault() {
        return dclfScreening == null ? DEFAULT_DCLF_SCREENING : dclfScreening;
    }

    public double dcLoadingCutoffOrDefault() {
        return dcLoadingCutoff == null ? DEFAULT_DC_LOADING_CUTOFF : dcLoadingCutoff;
    }

    public double dcFlowChangeCutoffOrDefault() {
        return dcFlowChangeCutoff == null ? DEFAULT_DC_FLOW_CHANGE_CUTOFF : dcFlowChangeCutoff;
    }

    public String solutionMethodOrDefault() {
        return solutionMethod == null ? SOLUTION_METHODS.get(0) : solutionMethod;
    }

    public int kluEndpointRhsBatchSizeOrDefault() {
        return kluEndpointRhsBatchSize == null ? 0 : kluEndpointRhsBatchSize;
    }

    public boolean cacheViolationCombinedShiftFactorsOrDefault() {
        return cacheViolationCombinedShiftFactors == null
                ? DEFAULT_CACHE_VIOLATION_SHIFT_FACTORS : cacheViolationCombinedShiftFactors;
    }

    public String islandingTreatmentOrDefault() {
        return islandingTreatment == null ? ISLANDING_TREATMENTS.get(1) : islandingTreatment;
    }

    public boolean n1IslandingReplayEnabledOrDefault() {
        return n1IslandingReplayEnabled == null ? DEFAULT_N1_ISLANDING_REPLAY : n1IslandingReplayEnabled;
    }

    public String multiOutageReplayModeOrDefault() {
        return multiOutageReplayMode == null ? MULTI_OUTAGE_REPLAY_MODES.get(0) : multiOutageReplayMode;
    }

    public double highImpedanceReactancePuOrDefault() {
        return highImpedanceReactancePu == null ? DEFAULT_HIGH_IMPEDANCE_REACTANCE_PU : highImpedanceReactancePu;
    }

    public boolean turnOffIslandBusOrDefault() {
        return turnOffIslandBus == null ? DEFAULT_TURN_OFF_ISLAND_BUS : turnOffIslandBus;
    }

    public boolean autoTurnLine2XfrOrDefault() {
        return autoTurnLine2Xfr == null ? DEFAULT_AUTO_TURN_LINE2XFR : autoTurnLine2Xfr;
    }

    public String ratingProviderOrDefault() {
        return ratingProvider == null ? DEFAULT_RATING_PROVIDER : ratingProvider;
    }

    /** Worker count; {@code 0} means one per available processor. */
    public int threadsOrDefault() {
        return threads == null ? DEFAULT_THREADS : threads;
    }

    private static String mode(String value, String source, String key) {
        if (value == null || value.isBlank()) {
            return ALL;
        }
        String normalized = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (!normalized.equals(ALL) && !normalized.equals(CUSTOM)) {
            throw new IllegalStateException(source + ": unsupported " + key + " '" + value
                    + "' (expected " + ALL + "|" + CUSTOM + ")");
        }
        return normalized;
    }

    /** Reject a threshold the runner could not honour rather than silently defaulting. */
    private static Double threshold(Double value, String source) {
        if (value == null) {
            return null;
        }
        if (!Double.isFinite(value) || value <= 0.0 || value > 1000.0) {
            throw new IllegalStateException(source
                    + ": overloadThreshold must be a loading percentage between 0 and 1000, got " + value);
        }
        return value;
    }

    /** A screening cutoff in percent: {@code 0} is a value (no cutoff), not a missing one. */
    private static Double cutoff(Double value, String source, String key) {
        if (value == null) {
            return null;
        }
        if (!Double.isFinite(value) || value < 0.0 || value > 1000.0) {
            throw new IllegalStateException(source
                    + ": " + key + " must be a percentage between 0 and 1000, got " + value);
        }
        return value;
    }

    private static Double positive(Double value, String source, String key) {
        if (value == null) {
            return null;
        }
        if (!Double.isFinite(value) || value <= 0.0) {
            throw new IllegalStateException(source + ": " + key + " must be a positive number, got " + value);
        }
        return value;
    }

    private static Integer count(Integer value, String source, String key) {
        if (value == null) {
            return null;
        }
        if (value < 0) {
            throw new IllegalStateException(source + ": " + key + " must be 0 or more, got " + value);
        }
        return value;
    }

    private static String choice(String value, List<String> allowed, String source, String key) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        for (String candidate : allowed) {
            if (candidate.equals(trimmed)) {
                return candidate;
            }
        }
        throw new IllegalStateException(source + ": unsupported " + key + " '" + value
                + "' (expected " + String.join("|", allowed) + ")");
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }
}
