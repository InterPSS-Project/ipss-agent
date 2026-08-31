package org.interpss.agent.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;

import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.input.PsseFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.agent.util.ProjectPaths;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ContingencyRunner_Texas2KTest {

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
        AgentTestSupport.setupTexas2KCase(paths);
        caseFilePath = paths.resolveWspace(AgentTestSupport.TEXAS2K_INPUT);
        resultsDir = paths.resultsDir(AgentTestSupport.TEXAS2K_INPUT);
        stem = ProjectPaths.outputStem(AgentTestSupport.TEXAS2K_INPUT);
        cliArgs = new CliArgs("ca", "psse", AgentTestSupport.TEXAS2K_INPUT,
                AgentTestSupport.TEXAS2K_CONT, AgentTestSupport.TEXAS2K_MONITOR);
    }

    @Test
    void run_writesContingencyCsv() throws Exception {
        ContingencyRunner.ContAnalysisSummary summary =
                ContingencyRunner.run(paths, cliArgs, caseFilePath.toString(), resultsDir, stem);
        System.out.println(summary);
        
        Path csv = resultsDir.resolve(stem + "_DF_contingency.csv");
        assertThat(csv).exists().content().isNotEmpty();
        assertThat(summary.numCont()).isEqualTo(2359);
        assertThat(summary.numMonitored()).isEqualTo(1308);
        assertThat(summary.numOverloads()).isEqualTo(csvDataRowCount(csv));
        assertThat(summary.numOverloads()).isEqualTo(53);
    }

    @Test
    void run_withLoadedNetwork_writesContingencyCsv() throws Exception {
        var net = PsseFileAdapter.createAclfNet(caseFilePath.toString());

        ContingencyRunner.ContAnalysisSummary summary =
                ContingencyRunner.run(paths, cliArgs, net, resultsDir, stem);

        Path csv = resultsDir.resolve(stem + "_DF_contingency.csv");
        assertThat(csv).exists().content().isNotEmpty();
        assertThat(summary.numOverloads()).isEqualTo(csvDataRowCount(csv));
    }

    private static long csvDataRowCount(Path csv) throws Exception {
        return java.nio.file.Files.lines(csv).skip(1).count();
    }

    @Test
    void validateInputs_allowsMissingContAndMonitorArgs() {
        CliArgs missingFiles = new CliArgs("ca", "psse", AgentTestSupport.TEXAS2K_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.validateInputs(paths, missingFiles);

        assertThat(inputs.contPath()).isNull();
        assertThat(inputs.monitorPath()).isNull();
    }

    @Test
    void validateInputs_rejectsMissingContingencyFile() {
        CliArgs cli = new CliArgs("ca", "psse", AgentTestSupport.TEXAS2K_INPUT,
                "missing/cont.json", AgentTestSupport.TEXAS2K_MONITOR);

        assertThatThrownBy(() -> ContingencyRunner.validateInputs(paths, cli))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Contingency file not found");
    }

    @Test
    void validateInputs_rejectsMissingMonitorFile() {
        CliArgs cli = new CliArgs("ca", "psse", AgentTestSupport.TEXAS2K_INPUT,
                AgentTestSupport.TEXAS2K_CONT, "missing/monitor.json");

        assertThatThrownBy(() -> ContingencyRunner.validateInputs(paths, cli))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Monitor file not found");
    }
}
