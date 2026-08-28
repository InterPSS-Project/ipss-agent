package org.interpss.agent.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.support.AgentTestSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProjectPathsTest {

    @TempDir
    Path tempDir;

    @Test
    void outputStem_stripsExtension() {
        assertThat(ProjectPaths.outputStem("data/ieee/Ieee118Bus/ieee118.ieee")).isEqualTo("ieee118");
    }

    @Test
    void inputParentRelative_returnsParentPath() {
        assertThat(ProjectPaths.inputParentRelative("data/ieee/Ieee118Bus/ieee118.ieee"))
                .isEqualTo("data/ieee/Ieee118Bus");
    }

    @Test
    void inputParentRelative_returnsEmptyForRootRelativeFile() {
        assertThat(ProjectPaths.inputParentRelative("ieee14.ieee")).isEmpty();
    }

    @Test
    void resolveWspaceAndResultsDir_createExpectedDirectories() throws Exception {
        ProjectPaths paths = AgentTestSupport.createProjectLayout(tempDir);
        AgentTestSupport.setupIeee14Case(paths);

        Path casePath = paths.resolveWspace(AgentTestSupport.IEEE14_INPUT);
        assertThat(casePath).exists();

        Path resultsDir = paths.resultsDir(AgentTestSupport.IEEE14_INPUT);
        assertThat(resultsDir).exists();
        assertThat(resultsDir.toString()).endsWith("data/ieee/Ieee14Bus/result");
    }

    @Test
    void resolveAclfRunConfig_prefersCaseLocalConfig() throws Exception {
        ProjectPaths paths = AgentTestSupport.createProjectLayout(tempDir);
        AgentTestSupport.setupIeee14Case(paths);

        Path config = paths.resolveAclfRunConfig(AgentTestSupport.IEEE14_INPUT);
        assertThat(config).isRegularFile();
        assertThat(config.toString()).contains("data/ieee/Ieee14Bus/config/aclf_run.json");
    }

    @Test
    void resolveAclfRunConfig_fallsBackToDefault() throws Exception {
        ProjectPaths paths = AgentTestSupport.createProjectLayout(tempDir);

        Path config = paths.resolveAclfRunConfig("standalone/case.ieee");
        assertThat(config).isRegularFile();
        assertThat(config).isEqualTo(paths.defaultAclfRunConfig());
    }

    @Test
    void discover_findsCurrentProjectRoot() {
        ProjectPaths discovered = ProjectPaths.discover();
        assertThat(discovered.projectRoot()).exists();
        assertThat(discovered.wspaceDir()).exists();
        assertThat(discovered.defaultAclfRunConfig()).exists();
    }

    @Test
    void constructor_throwsWhenWspaceMissing() throws Exception {
        Path root = tempDir.resolve("no-wspace");
        Files.createDirectories(root.resolve("config"));

        assertThatThrownBy(() -> new ProjectPaths(root))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("wspace directory not found");
    }
}
