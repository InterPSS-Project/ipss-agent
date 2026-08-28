package org.interpss.agent.runner;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.agent.util.ProjectPaths;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AclfRunnerTest {

    @TempDir
    Path tempDir;

    private ProjectPaths paths;
    private Path caseFilePath;
    private Path resultsDir;
    private String stem;

    @BeforeEach
    void setUp() throws Exception {
        paths = AgentTestSupport.createProjectLayout(tempDir);
        AgentTestSupport.setupIeee14Case(paths);
        caseFilePath = paths.resolveWspace(AgentTestSupport.IEEE14_INPUT);
        resultsDir = paths.resultsDir(AgentTestSupport.IEEE14_INPUT);
        stem = ProjectPaths.outputStem(AgentTestSupport.IEEE14_INPUT);
    }

    @Test
    void run_withFormatAndCaseFile_writesExpectedOutputs() throws Exception {
        AclfRunner.run(paths, "ieee", caseFilePath.toString(), AgentTestSupport.IEEE14_INPUT, resultsDir, stem);

        assertOutputFilesExist();
        assertThat(Files.readString(resultsDir.resolve(stem + "_network_info.txt")))
                .contains("Loadflow converged: true");
    }

    @Test
    void run_withLoadedNetwork_writesExpectedOutputs() throws Exception {
        var net = IeeeFileAdapter.createAclfNet(caseFilePath.toString());

        AclfRunner.run(paths, AgentTestSupport.IEEE14_INPUT, net, resultsDir, stem);

        assertOutputFilesExist();
    }

    private void assertOutputFilesExist() {
        assertThat(resultsDir.resolve(stem + "_network_info.txt")).exists();
        assertThat(resultsDir.resolve(stem + "_DF_bus.csv")).exists().content().isNotEmpty();
        assertThat(resultsDir.resolve(stem + "_DF_gen.csv")).exists().content().isNotEmpty();
        assertThat(resultsDir.resolve(stem + "_DF_load.csv")).exists().content().isNotEmpty();
        assertThat(resultsDir.resolve(stem + "_DF_branch.csv")).exists().content().isNotEmpty();
    }
}
