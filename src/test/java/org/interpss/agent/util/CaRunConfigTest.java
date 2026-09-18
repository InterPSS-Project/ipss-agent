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

    private Path write(String json) throws Exception {
        Path file = tempDir.resolve("ca_run.json");
        Files.writeString(file, json);
        return file;
    }
}
