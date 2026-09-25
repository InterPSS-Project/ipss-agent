package org.interpss.agent.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.agent.util.ProjectPaths;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ContingencyRunnerTest {

    @TempDir
    Path tempDir;

    private ProjectPaths paths;
    private Path caseFilePath;
    private Path resultsDir;
    private String stem;
    private CliArgs cliArgs;

    @BeforeEach
    void setUp() throws Exception {
        paths = AgentTestSupport.createProjectLayout(tempDir);
        AgentTestSupport.setupIeee14Case(paths);
        caseFilePath = paths.resolveWspace(AgentTestSupport.IEEE14_INPUT);
        resultsDir = paths.resultsDir(AgentTestSupport.IEEE14_INPUT);
        stem = ProjectPaths.outputStem(AgentTestSupport.IEEE14_INPUT);
        cliArgs = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR);
    }

    @Test
    void run_writesContingencyCsv() throws Exception {
        ContingencyRunner.ContAnalysisSummary summary =
                ContingencyRunner.run(paths, cliArgs, caseFilePath.toString(), resultsDir, stem);

        Path csv = resultsDir.resolve(stem + "_DF_contingency.csv");
        assertThat(csv).exists().content().isNotEmpty();
        assertThat(summary.numOverloads()).isEqualTo(java.nio.file.Files.lines(csv).skip(1).count());
        // Must be row count, not DataFrame columnCount (11)
        assertThat(summary.numOverloads()).isNotEqualTo(11);
    }

    @Test
    void run_withLoadedNetwork_writesContingencyCsv() throws Exception {
        var net = IeeeFileAdapter.createAclfNet(caseFilePath.toString());

        ContingencyRunner.run(paths, cliArgs, net, resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
    }

    @Test
    void run_withoutContAndMonitorFiles_writesContingencyCsv() throws Exception {
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.run(paths, noFiles, caseFilePath.toString(), resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
    }

    @Test
    void validateInputs_allowsMissingContAndMonitorArgs() {
        CliArgs missingFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.validateInputs(paths, missingFiles);

        assertThat(inputs.contPath()).isNull();
        assertThat(inputs.monitorPath()).isNull();
    }

    @Test
    void validateInputs_rejectsMissingContingencyFile() {
        CliArgs cli = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                "missing/cont.json", AgentTestSupport.IEEE14_MONITOR);

        assertThatThrownBy(() -> ContingencyRunner.validateInputs(paths, cli))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Contingency file not found");
    }

    @Test
    void validateInputs_rejectsMissingMonitorFile() {
        CliArgs cli = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                AgentTestSupport.IEEE14_CONT, "missing/monitor.json");

        assertThatThrownBy(() -> ContingencyRunner.validateInputs(paths, cli))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Monitor file not found");
    }

    @Test
    void resolveInputs_usesCaseCaRunConfig() throws Exception {
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.resolveInputs(paths, noFiles);

        assertThat(inputs.contPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_CONT));
        assertThat(inputs.monitorPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_MONITOR));
    }

    @Test
    void resolveInputs_explicitArgsOverrideConfig() throws Exception {
        // The config names the monitored-branches file only; the CLI supplies the contingency file.
        writeCaRunConfig(null, AgentTestSupport.IEEE14_MONITOR);
        CliArgs cli = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                AgentTestSupport.IEEE14_CONT, null);

        ContingencyRunner.ValidatedContingencyInputs inputs = ContingencyRunner.resolveInputs(paths, cli);

        assertThat(inputs.contPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_CONT));
        assertThat(inputs.monitorPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_MONITOR));
    }

    @Test
    void resolveInputs_fallsBackToDefaultsWithoutConfig() {
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.resolveInputs(paths, noFiles);

        assertThat(inputs.contPath()).isNull();
        assertThat(inputs.monitorPath()).isNull();
    }

    @Test
    void resolveInputs_ignoresFilesWhenModeIsAll() throws Exception {
        // A named file with mode "all" is inert: the mode decides, not the key.
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR, "all", "all");
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.resolveInputs(paths, noFiles);

        assertThat(inputs.contPath()).isNull();
        assertThat(inputs.monitorPath()).isNull();
    }

    @Test
    void resolveInputs_rejectsMissingFileFromConfig() throws Exception {
        writeCaRunConfig("data/ieee/Ieee14Bus/missing_contingencies.json", AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("contingencyFile not found");
    }

    @Test
    void resolveInputs_rejectsCustomModeWithoutFile() throws Exception {
        // Mode custom with a null file key: the helper's 2-arg form cannot
        // express this, so write both modes explicitly.
        writeCaRunConfig(null, AgentTestSupport.IEEE14_MONITOR, "custom", "custom");
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("names no contingencyFile");
    }

    @Test
    void resolveInputs_rejectsPathTraversal() throws Exception {
        writeCaRunConfig("../../etc/passwd", AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be a path under wspace/");
    }

    @Test
    void resolveInputs_rejectsUnsupportedMode() throws Exception {
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR, "n1", "custom");
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported contingencyMode");
    }

    @Test
    void run_withCaseCaRunConfig_writesContingencyCsv() throws Exception {
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ContAnalysisSummary summary =
                ContingencyRunner.run(paths, noFiles, caseFilePath.toString(), resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
        // 1 contingency / 3 monitored branches in the ieee14 fixtures.
        assertThat(summary.numCont()).isEqualTo(1);
        assertThat(summary.numMonitored()).isEqualTo(3);
    }

    /** Write the case {@code config/ca_run.json}; a null file key leaves the mode at {@code all}. */
    private void writeCaRunConfig(String contingencyFile, String monitoredBranchFile) throws Exception {
        writeCaRunConfig(contingencyFile, monitoredBranchFile,
                contingencyFile == null ? "all" : "custom",
                monitoredBranchFile == null ? "all" : "custom");
    }

    private void writeCaRunConfig(String contingencyFile, String monitoredBranchFile,
            String contingencyMode, String monitorMode) throws Exception {
        Path config = paths.caseCaRunConfig(AgentTestSupport.IEEE14_INPUT);
        Files.createDirectories(config.getParent());
        StringBuilder json = new StringBuilder("{\n");
        json.append("  \"contingencyMode\": \"").append(contingencyMode).append("\",\n");
        json.append("  \"contingencyFile\": ").append(quote(contingencyFile)).append(",\n");
        json.append("  \"monitorMode\": \"").append(monitorMode).append("\",\n");
        json.append("  \"monitoredBranchFile\": ").append(quote(monitoredBranchFile)).append("\n}\n");
        Files.writeString(config, json.toString());
    }

    private static String quote(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }
}
