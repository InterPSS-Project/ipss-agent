package org.interpss.agent;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.cli.ReportCliArgs;
import org.interpss.agent.report.ReportRunner;
import org.interpss.agent.runner.AclfRunner;
import org.interpss.agent.runner.ContingencyRunner;
import org.interpss.agent.util.ProjectPaths;

/**
 * InterPSS command-line tool: AC load flow and DC contingency analysis.
 * Native Java entry point for ACLF and DC contingency analysis.
 */
public final class IpssCmd {

    private IpssCmd() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && "report".equals(args[0])) {
            ReportCliArgs reportCli = ReportCliArgs.parse(args);
            ProjectPaths paths = ProjectPaths.discover();
            executeReport(reportCli, paths);
            return;
        }
        CliArgs cli = CliArgs.parse(args);
        ProjectPaths paths = ProjectPaths.discover();
        execute(cli, paths);
    }

    public static void executeReport(ReportCliArgs cli, ProjectPaths paths) throws Exception {
        ReportRunner runner = new ReportRunner(paths);
        ReportRunner.ReportOutput output = runner.run(
                cli.reportType(), cli.displayName(), cli.resultDir(), cli.csvPrefix());
        System.out.println(output.markdown());
        System.out.println("\nReport saved to: " + output.reportFile());
    }

    public static void execute(CliArgs cli, ProjectPaths paths) throws Exception {
        Path caseFile = paths.resolveWspace(cli.input());
        if (!Files.isRegularFile(caseFile)) {
            throw new IllegalArgumentException("Case file not found: " + caseFile);
        }

        String caseFilePath = caseFile.toString();
        Path resultsDir = paths.resultsDir(cli.input());
        String stem = ProjectPaths.outputStem(cli.input());

        switch (cli.simutype()) {
            case "aclf" -> AclfRunner.run(paths, cli.format(), caseFilePath, cli.input(), resultsDir, stem);
            case "ca" -> {
                try {
                    ContingencyRunner.run(paths, cli, caseFilePath, resultsDir, stem);
                } catch (IllegalArgumentException | IllegalStateException e) {
                    System.err.println(e.getMessage());
                    CliArgs.printUsage();
                    System.exit(1);
                }
            }
            default -> {
                System.err.println("Invalid simulation type");
                System.exit(1);
            }
        }
    }
}
