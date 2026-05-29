package org.interpss.agent;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.runner.AclfRunner;
import org.interpss.agent.runner.ContingencyRunner;
import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.util.ProjectPaths;

import com.interpss.core.aclf.AclfNetwork;

/**
 * InterPSS command-line tool: AC load flow and DC contingency analysis.
 * Native Java entry point for ACLF and DC contingency analysis.
 */
public final class IpssCmd {

    private IpssCmd() {
    }

    public static void main(String[] args) throws Exception {
        CliArgs cli = CliArgs.parse(args);
        ProjectPaths paths = ProjectPaths.discover();

        Path caseFile = paths.resolveWspace(cli.input());
        if (!Files.isRegularFile(caseFile)) {
            System.err.println("Case file not found: " + caseFile);
            System.exit(1);
        }

        AclfNetwork net = NetworkLoader.loadNetwork(cli.format(), caseFile.toString());
        Path resultsDir = paths.resultsDir(cli.input());
        String stem = ProjectPaths.outputStem(cli.input());

        switch (cli.simutype()) {
            case "aclf" -> AclfRunner.run(paths, cli.input(), net, resultsDir, stem);
            case "ca" -> ContingencyRunner.run(paths, cli, net, resultsDir, stem);
            default -> {
                System.err.println("Invalid simulation type");
                System.exit(1);
            }
        } 
    }
}
