package org.interpss.agent.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
        ContingencyRunner.run(paths, cliArgs, caseFilePath.toString(), resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
    }

    @Test
    void run_withLoadedNetwork_writesContingencyCsv() throws Exception {
        var net = IeeeFileAdapter.createAclfNet(caseFilePath.toString());

        ContingencyRunner.run(paths, cliArgs, net, resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
    }

    @Test
    void validateInputs_rejectsMissingContAndMonitorArgs() {
        CliArgs missingFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.validateInputs(paths, missingFiles))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("cont_file and monitor_file");
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
}
