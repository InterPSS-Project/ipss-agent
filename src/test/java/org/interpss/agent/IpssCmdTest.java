package org.interpss.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.agent.util.ProjectPaths;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class IpssCmdTest {

    @TempDir
    Path tempDir;

    private ProjectPaths paths;

    @BeforeEach
    void setUp() throws Exception {
        paths = AgentTestSupport.createProjectLayout(tempDir);
        AgentTestSupport.setupIeee14Case(paths);
    }

    @Test
    void execute_runsAclfForValidCase() throws Exception {
        CliArgs cli = CliArgs.parseValidated(new String[] {
                "aclf", "ieee", AgentTestSupport.IEEE14_INPUT
        });

        IpssCmd.execute(cli, paths);

        String stem = ProjectPaths.outputStem(AgentTestSupport.IEEE14_INPUT);
        Path resultsDir = paths.resultsDir(AgentTestSupport.IEEE14_INPUT);
        assertThat(resultsDir.resolve(stem + "_network_info.txt")).exists();
        assertThat(resultsDir.resolve(stem + "_DF_bus.csv")).exists();
    }

    @Test
    void execute_throwsWhenCaseFileMissing() {
        CliArgs cli = CliArgs.parseValidated(new String[] {
                "aclf", "ieee", "data/missing/case.ieee"
        });

        assertThatThrownBy(() -> IpssCmd.execute(cli, paths))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Case file not found");
    }

    @Test
    void execute_runsContingencyAnalysisForValidCase() throws Exception {
        CliArgs cli = CliArgs.parseValidated(new String[] {
                "ca",
                "ieee",
                AgentTestSupport.IEEE14_INPUT,
                AgentTestSupport.IEEE14_CONT,
                AgentTestSupport.IEEE14_MONITOR
        });

        IpssCmd.execute(cli, paths);

        String stem = ProjectPaths.outputStem(AgentTestSupport.IEEE14_INPUT);
        Path resultsDir = paths.resultsDir(AgentTestSupport.IEEE14_INPUT);
        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists();
    }
}
