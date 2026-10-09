package org.interpss.agent.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CaRunConfigTest {

    @TempDir
    Path tempDir;

    @Test
    void load_readsAllFourFields() throws Exception {
        Path file = write("{\n"
                + "  \"contingencyMode\": \"custom\",\n"
                + "  \"contingencyFile\": \"data/psse/Texas2K/2k_contingencies_115kVAbove.json\",\n"
                + "  \"monitorMode\": \"custom\",\n"
                + "  \"monitoredBranchFile\": \"data/psse/Texas2K/2k_monitored_branches.json\"\n"
                + "}\n");

        CaRunConfig config = CaRunConfig.load(file);

        assertThat(config.contingencyIsCustom()).isTrue();
        assertThat(config.monitorIsCustom()).isTrue();
        assertThat(config.contingencyInput()).isEqualTo("data/psse/Texas2K/2k_contingencies_115kVAbove.json");
        assertThat(config.monitoredBranchInput()).isEqualTo("data/psse/Texas2K/2k_monitored_branches.json");
    }

    @Test
    void load_defaultsMissingKeysToAll() throws Exception {
        Path file = write("{}\n");

        CaRunConfig config = CaRunConfig.load(file);

        assertThat(config.contingencyMode()).isEqualTo(CaRunConfig.ALL);
        assertThat(config.monitorMode()).isEqualTo(CaRunConfig.ALL);
        assertThat(config.contingencyFile()).isNull();
        assertThat(config.monitoredBranchFile()).isNull();
        assertThat(config.contingencyInput()).isNull();
        assertThat(config.monitoredBranchInput()).isNull();
    }

    @Test
    void load_ignoresUnknownKeysAndNormalisesBlanks() throws Exception {
        Path file = write("{\n"
                + "  \"contingencyMode\": \"  CUSTOM  \",\n"
                + "  \"contingencyFile\": \"  \",\n"
                + "  \"monitorMode\": \"\",\n"
                + "  \"futureSetting\": 42\n"
                + "}\n");

        CaRunConfig config = CaRunConfig.load(file);

        assertThat(config.contingencyMode()).isEqualTo(CaRunConfig.CUSTOM);
        assertThat(config.contingencyFile()).isNull();
        assertThat(config.monitorMode()).isEqualTo(CaRunConfig.ALL);
        // Mode is custom but no file is named: the runner rejects this, not the parser.
        assertThat(config.contingencyInput()).isNull();
    }

    @Test
    void load_rejectsUnsupportedMode() throws Exception {
        Path file = write("{\"contingencyMode\": \"n1\", \"monitorMode\": \"custom\"}\n");

        assertThatThrownBy(() -> CaRunConfig.load(file))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported contingencyMode 'n1'")
                .hasMessageContaining("all|custom");
    }

    @Test
    void load_rejectsUnsupportedMonitorMode() throws Exception {
        Path file = write("{\"monitorMode\": \"selected\"}\n");

        assertThatThrownBy(() -> CaRunConfig.load(file))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported monitorMode 'selected'");
    }

    @Test
    void load_rejectsInvalidJson() throws Exception {
        Path file = write("{ not json\n");

        assertThatThrownBy(() -> CaRunConfig.load(file))
                .isInstanceOf(com.google.gson.JsonSyntaxException.class);
    }

    @Test
    void default_isAllForBothSections() {
        assertThat(CaRunConfig.DEFAULT.contingencyIsCustom()).isFalse();
        assertThat(CaRunConfig.DEFAULT.monitorIsCustom()).isFalse();
        assertThat(CaRunConfig.DEFAULT.contingencyFile()).isNull();
        assertThat(CaRunConfig.DEFAULT.monitoredBranchFile()).isNull();
    }

    /**
     * The solver knobs were exposed after the runner already had values for them. These are
     * those values: a config file (or tool call) that names none of the new keys must behave
     * exactly as every run did before they existed.
     */
    @Test
    void solverDefaults_matchWhatTheRunnerUsedBeforeTheKnobsWereExposed() {
        CaRunConfig config = CaRunConfig.DEFAULT;

        assertThat(config.overloadThresholdOrDefault()).isEqualTo(90.0);
        assertThat(config.dclfInclLossOrDefault()).isTrue();
        assertThat(config.dclfScreeningOrDefault()).isFalse();
        assertThat(config.dcLoadingCutoffOrDefault()).isEqualTo(100.0);
        assertThat(config.dcFlowChangeCutoffOrDefault()).isEqualTo(200.0);
        assertThat(config.solutionMethodOrDefault()).isEqualTo("SparseEqnSolve");
        assertThat(config.kluEndpointRhsBatchSizeOrDefault()).isZero();
        assertThat(config.cacheViolationCombinedShiftFactorsOrDefault()).isFalse();
        assertThat(config.islandingTreatmentOrDefault()).isEqualTo("ANCHORED_COMPENSATE_ONE_BUS");
        assertThat(config.n1IslandingReplayEnabledOrDefault()).isFalse();
        assertThat(config.multiOutageReplayModeOrDefault()).isEqualTo("EXACT_TOPOLOGY");
        assertThat(config.highImpedanceReactancePuOrDefault()).isEqualTo(10000.0);
        assertThat(config.turnOffIslandBusOrDefault()).isTrue();
        assertThat(config.autoTurnLine2XfrOrDefault()).isTrue();
        assertThat(config.ratingProviderOrDefault()).isEqualTo(CaRunConfig.DEFAULT_RATING_PROVIDER);
        assertThat(config.threadsOrDefault()).isZero();
    }

    @Test
    void solverKnobs_roundTripThroughTheFile() throws Exception {
        Path file = write("{\n"
                + "  \"overloadThreshold\": 75,\n"
                + "  \"dclfInclLoss\": false,\n"
                + "  \"dclfScreening\": true,\n"
                + "  \"dcLoadingCutoff\": 0,\n"
                + "  \"dcFlowChangeCutoff\": 250,\n"
                + "  \"solutionMethod\": \"WoodburyMatrixUpdate\",\n"
                + "  \"kluEndpointRhsBatchSize\": 8,\n"
                + "  \"cacheViolationCombinedShiftFactors\": true,\n"
                + "  \"islandingTreatment\": \"SKIP\",\n"
                + "  \"n1IslandingReplayEnabled\": true,\n"
                + "  \"multiOutageReplayMode\": \"HIGH_IMPEDANCE\",\n"
                + "  \"highImpedanceReactancePu\": 1234.5,\n"
                + "  \"turnOffIslandBus\": false,\n"
                + "  \"autoTurnLine2Xfr\": false,\n"
                + "  \"ratingProvider\": \"RATING_A\",\n"
                + "  \"threads\": 2\n"
                + "}\n");

        CaRunConfig config = CaRunConfig.load(file);

        assertThat(config.overloadThresholdOrDefault()).isEqualTo(75.0);
        assertThat(config.dclfInclLossOrDefault()).isFalse();
        assertThat(config.dclfScreeningOrDefault()).isTrue();
        assertThat(config.dcLoadingCutoffOrDefault()).isZero();
        assertThat(config.dcFlowChangeCutoffOrDefault()).isEqualTo(250.0);
        assertThat(config.solutionMethodOrDefault()).isEqualTo("WoodburyMatrixUpdate");
        assertThat(config.kluEndpointRhsBatchSizeOrDefault()).isEqualTo(8);
        assertThat(config.cacheViolationCombinedShiftFactorsOrDefault()).isTrue();
        assertThat(config.islandingTreatmentOrDefault()).isEqualTo("SKIP");
        assertThat(config.n1IslandingReplayEnabledOrDefault()).isTrue();
        assertThat(config.multiOutageReplayModeOrDefault()).isEqualTo("HIGH_IMPEDANCE");
        assertThat(config.highImpedanceReactancePuOrDefault()).isEqualTo(1234.5);
        assertThat(config.turnOffIslandBusOrDefault()).isFalse();
        assertThat(config.autoTurnLine2XfrOrDefault()).isFalse();
        assertThat(config.ratingProviderOrDefault()).isEqualTo("RATING_A");
        assertThat(config.threadsOrDefault()).isEqualTo(2);
    }

    /** A knob the solver cannot honour is a loud error, never a silent default. */
    @Test
    void solverKnobs_rejectUnusableValues() {
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"solutionMethod\":\"Nope\"}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported solutionMethod 'Nope'")
                .hasMessageContaining("SparseEqnSolve|WoodburyMatrixUpdate");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"islandingTreatment\":\"MAGIC\"}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported islandingTreatment");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"multiOutageReplayMode\":\"MAGIC\"}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported multiOutageReplayMode");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"ratingProvider\":\"RATING_C\"}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported ratingProvider");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"dcLoadingCutoff\":-1}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("dcLoadingCutoff must be a percentage between 0 and 1000");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"dcFlowChangeCutoff\":1001}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("dcFlowChangeCutoff");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"threads\":-2}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("threads must be 0 or more");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"kluEndpointRhsBatchSize\":-1}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("kluEndpointRhsBatchSize must be 0 or more");
        assertThatThrownBy(() -> CaRunConfig.fromJson("{\"highImpedanceReactancePu\":0}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("highImpedanceReactancePu must be a positive number");

        // A blank payload and a payload that only names valid values are both accepted.
        assertThat(CaRunConfig.fromJson("", "test")).isEqualTo(CaRunConfig.DEFAULT);
        assertThat(CaRunConfig.fromJson("{\"dcLoadingCutoff\":0}", "test").dcLoadingCutoffOrDefault())
                .isZero();
    }

    /** The tool's per-call threshold override is a copy, not a mutation. */
    @Test
    void withOverloadThreshold_keepsEveryOtherKnob() {
        CaRunConfig strict = CaRunConfig.fromJson("{\"threads\":3,\"ratingProvider\":\"RATING_B\"}", "test")
                .withOverloadThreshold(55.0);

        assertThat(strict.overloadThresholdOrDefault()).isEqualTo(55.0);
        assertThat(strict.threadsOrDefault()).isEqualTo(3);
        assertThat(strict.ratingProviderOrDefault()).isEqualTo("RATING_B");
        assertThat(CaRunConfig.DEFAULT.overloadThresholdOrDefault()).isEqualTo(90.0);
    }

    private Path write(String json) throws Exception {
        Path file = tempDir.resolve("ca_run.json");
        Files.writeString(file, json);
        return file;
    }
}
