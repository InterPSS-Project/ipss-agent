package org.interpss.agent.runner.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OptAdjRunConfigTest {

    @TempDir
    Path tempDir;

    @Test
    void default_isSampleThresholdsWithNoContingencyPin() {
        OptAdjRunConfig config = OptAdjRunConfig.DEFAULT;

        assertThat(config.scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_BASE_CASE)).isEqualTo(50.0);
        assertThat(config.scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_CA_N1)).isEqualTo(90.0);
        assertThat(config.optAdjLoadingThresholdOrDefault()).isEqualTo(100.0);
        assertThat(config.threadsOrDefault()).isZero();
        assertThat(config.sparseSenMatrixOrDefault()).isTrue();
        assertThat(config.contingencyIsCustom()).isFalse();
        assertThat(config.contingencyInput()).isNull();
    }

    /** The doc's two samples use different scan percentages; unset follows the mode argument. */
    @Test
    void unsetScanThreshold_followsTheMode() {
        assertThat(new OptAdjRunConfig(null, null)
                .scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_BASE_CASE)).isEqualTo(50.0);
        assertThat(new OptAdjRunConfig(null, null)
                .scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_CA_N1)).isEqualTo(90.0);
        assertThat(OptAdjRunConfig.isCaN1(OptAdjRunConfig.GEN_ADJ_CA_N1)).isTrue();
        assertThat(OptAdjRunConfig.isCaN1(OptAdjRunConfig.GEN_ADJ_BASE_CASE)).isFalse();
        // An explicit value wins in either mode.
        assertThat(new OptAdjRunConfig(80.0, null)
                .scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_CA_N1)).isEqualTo(80.0);
        assertThat(new OptAdjRunConfig(95.0, null)
                .scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_BASE_CASE)).isEqualTo(95.0);
    }

    /** The two-argument form is what the IEEE-39 samples in the repo call. */
    @Test
    void twoArgumentConstructor_keepsTheSamplesCompiling() {
        OptAdjRunConfig config = new OptAdjRunConfig(50.0, 100.0);

        assertThat(config.scanLoadingThreshold()).isEqualTo(50.0);
        assertThat(config.optAdjLoadingThreshold()).isEqualTo(100.0);
        assertThat(config.contingencyMode()).isEqualTo(OptAdjRunConfig.ALL);
        assertThat(config.contingencyFile()).isNull();
        assertThat(config.sparseSenMatrixOrDefault()).isTrue();
        assertThat(config.threadsOrDefault()).isZero();
    }

    @Test
    void load_readsEveryFileField() throws Exception {
        Path file = write("{\n"
                + "  \"scanLoadingThreshold\": 85,\n"
                + "  \"optAdjLoadingThreshold\": 99,\n"
                + "  \"contingencyMode\": \"custom\",\n"
                + "  \"contingencyFile\": \"data/psse/Texas2K/2k_contingencies_115kVAbove.json\",\n"
                + "  \"sparseSenMatrix\": false,\n"
                + "  \"threads\": 4\n"
                + "}\n");

        OptAdjRunConfig config = OptAdjRunConfig.load(file);

        assertThat(config.scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_CA_N1)).isEqualTo(85.0);
        assertThat(config.optAdjLoadingThresholdOrDefault()).isEqualTo(99.0);
        assertThat(config.contingencyIsCustom()).isTrue();
        assertThat(config.contingencyInput()).isEqualTo("data/psse/Texas2K/2k_contingencies_115kVAbove.json");
        assertThat(config.sparseSenMatrixOrDefault()).isFalse();
        assertThat(config.threadsOrDefault()).isEqualTo(4);
    }

    @Test
    void load_ignoresLeftoverOptAdjTypeAndUnknownKeys() throws Exception {
        Path file = write("{\n"
                + "  \"optAdjType\": \"genAdjCA_N-1\",\n"
                + "  \"contingencyMode\": \"  CUSTOM  \",\n"
                + "  \"contingencyFile\": \"  \",\n"
                + "  \"futureSetting\": 42\n"
                + "}\n");

        OptAdjRunConfig config = OptAdjRunConfig.load(file);

        assertThat(config.contingencyMode()).isEqualTo(OptAdjRunConfig.CUSTOM);
        assertThat(config.contingencyFile()).isNull();
        // Mode is custom but no file is named: the runner rejects this, not the parser.
        assertThat(config.contingencyInput()).isNull();
        // Leftover optAdjType is ignored — the mode is a runner argument.
        assertThat(config.scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_BASE_CASE)).isEqualTo(50.0);
    }

    @Test
    void parseType_validatesTheCallerMode() {
        assertThat(OptAdjRunConfig.parseType(null, "test")).isEqualTo(OptAdjRunConfig.GEN_ADJ_BASE_CASE);
        assertThat(OptAdjRunConfig.parseType("  ", "test")).isEqualTo(OptAdjRunConfig.GEN_ADJ_BASE_CASE);
        assertThat(OptAdjRunConfig.parseType(OptAdjRunConfig.GEN_ADJ_CA_N1, "test"))
                .isEqualTo(OptAdjRunConfig.GEN_ADJ_CA_N1);
        assertThatThrownBy(() -> OptAdjRunConfig.parseType("genAdjN2", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported optAdjType 'genAdjN2'")
                .hasMessageContaining("genAdjBaseCase|genAdjCA_N-1");
        // The Host maps the retired spelling; Java rejects it so a stale JAR cannot silently run.
        assertThatThrownBy(() -> OptAdjRunConfig.parseType("genAdjCaN_1", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported optAdjType 'genAdjCaN_1'");
    }

    /** A value the runner could not honour is a loud error, never a silent default. */
    @Test
    void load_rejectsUnusableValues() {
        assertThatThrownBy(() -> OptAdjRunConfig.fromJson("{\"scanLoadingThreshold\":0}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("scanLoadingThreshold must be a loading percentage between 0 and 1000");
        assertThatThrownBy(() -> OptAdjRunConfig.fromJson("{\"scanLoadingThreshold\":1001}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("scanLoadingThreshold");
        assertThatThrownBy(() -> OptAdjRunConfig.fromJson("{\"optAdjLoadingThreshold\":-1}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("optAdjLoadingThreshold must be a loading percentage");
        assertThatThrownBy(() -> OptAdjRunConfig.fromJson("{\"contingencyMode\":\"selected\"}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported contingencyMode 'selected'")
                .hasMessageContaining("all|custom");
        assertThatThrownBy(() -> OptAdjRunConfig.fromJson("{\"threads\":-2}", "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("threads must be 0 or more");
        assertThatThrownBy(() -> OptAdjRunConfig.load(write("{ not json\n")))
                .isInstanceOf(com.google.gson.JsonSyntaxException.class);

        // A blank payload is the default, and the boundaries are accepted.
        assertThat(OptAdjRunConfig.fromJson("", "test")).isEqualTo(OptAdjRunConfig.DEFAULT);
        assertThat(OptAdjRunConfig.fromJson("{\"scanLoadingThreshold\":1000}", "test")
                .scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_BASE_CASE)).isEqualTo(1000.0);
    }

    /** The tool's per-call scan override is a copy, not a mutation. */
    @Test
    void withScanLoadingThreshold_keepsEveryOtherField() {
        OptAdjRunConfig stricter = OptAdjRunConfig
                .fromJson("{\"threads\":3,\"contingencyMode\":\"custom\","
                        + "\"contingencyFile\":\"data/x.json\",\"sparseSenMatrix\":false}", "test")
                .withScanLoadingThreshold(70.0);

        assertThat(stricter.scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_CA_N1)).isEqualTo(70.0);
        assertThat(stricter.threadsOrDefault()).isEqualTo(3);
        assertThat(stricter.sparseSenMatrixOrDefault()).isFalse();
        assertThat(stricter.contingencyInput()).isEqualTo("data/x.json");
        assertThat(OptAdjRunConfig.DEFAULT.scanLoadingThresholdOrDefault(OptAdjRunConfig.GEN_ADJ_BASE_CASE))
                .isEqualTo(50.0);
    }

    private Path write(String json) throws Exception {
        Path file = tempDir.resolve("opt_adj_run.json");
        Files.writeString(file, json);
        return file;
    }
}
