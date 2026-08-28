package org.interpss.agent;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.cli.ReportCliArgs;
import org.interpss.agent.util.ProjectPaths;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

class ReportCliTest {

    private static ProjectPaths paths;

    @BeforeAll
    static void setUp() {
        paths = ProjectPaths.discover();
    }

    @Test
    @EnabledIf("ieee14ResultExists")
    void executeReport_writesNercMarkdown() throws Exception {
        ReportCliArgs cli = ReportCliArgs.parseValidated(new String[] {
                "report", "nerc", "IEEE 14-Bus System", "data/ieee/Ieee14Bus/result"
        });
        IpssCmd.executeReport(cli, paths);
        Path report = paths.resolveWspace("data/ieee/Ieee14Bus/result/NERC_TPL_001_5_Report.md");
        assertThat(report).exists();
        assertThat(Files.readString(report)).contains("NERC TPL-001-5 Transmission System Planning Performance");
    }

    static boolean ieee14ResultExists() {
        return Files.isRegularFile(Path.of("wspace/data/ieee/Ieee14Bus/result/ieee14_DF_bus.csv"))
                || Files.isRegularFile(Path.of(".").resolve("wspace/data/ieee/Ieee14Bus/result/ieee14_DF_bus.csv"));
    }
}
