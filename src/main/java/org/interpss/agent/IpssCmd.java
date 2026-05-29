package org.interpss.agent;

import static com.interpss.core.DclfAlgoObjectFactory.createContingencyAnalysisAlgorithm;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.stream.Collectors;

import org.dflib.DataFrame;
import org.dflib.csv.Csv;
import org.interpss.agent.util.IpssNetworkInfo;
import org.interpss.agent.util.ProjectPaths;
import org.interpss.plugin.aclf.config.AclfRunConfigRec;
import org.interpss.plugin.contingency.DclfContingencyConfig;
import org.interpss.plugin.contingency.ParallelDclfContingencyAnalyzer;
import org.interpss.plugin.contingency.definition.BranchContingencyRecord;
import org.interpss.plugin.contingency.definition.MonitoredBranchRecord;
import org.interpss.plugin.contingency.util.ContingencyFileUtil;
import org.interpss.plugin.contingency.util.DclfContingencyHelper;
import org.interpss.plugin.pssl.plugin.IpssAdapter;
import org.interpss.plugin.result.dframe.AclfNetDFrameAdapter;
import org.interpss.plugin.result.dframe.ca.DclfContingencyDFrameAdapter;

import com.interpss.algo.parallel.BranchCAResultRec;
import com.interpss.core.LoadflowAlgoObjectFactory;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.LoadflowAlgorithm;
import com.interpss.core.algo.dclf.ContingencyAnalysisAlgorithm;
import com.interpss.core.algo.dclf.DclfMethod;
import com.interpss.core.contingency.dclf.DclfBranchOutage;

import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.IEEECommonFormat;
import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.PSSE;
import org.interpss.plugin.pssl.plugin.IpssAdapter.PsseVersion;

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

        Path caseFile = paths.resolveWspace(cli.input);
        if (!Files.isRegularFile(caseFile)) {
            System.err.println("Case file not found: " + caseFile);
            System.exit(1);
        }

        AclfNetwork net = loadNetwork(cli.format, caseFile.toString());
        Path resultsDir = paths.resultsDir(cli.input);
        String stem = ProjectPaths.outputStem(cli.input);

        switch (cli.simutype) {
            case "aclf" -> runAclf(paths, cli.input, net, resultsDir, stem);
            case "ca" -> runCa(paths, cli, net, resultsDir, stem);
            default -> {
                System.err.println("Invalid simulation type");
                System.exit(1);
            }
        }
    }

    // TODO: put the loadNetwork in a separate file
    private static AclfNetwork loadNetwork(String format, String filePath) throws Exception {
        return switch (format) {
            case "ieee" -> createIeeeAclfNet(filePath);
            case "psse" -> createPsseAclfNet(filePath);
            default -> {
                System.err.println("Invalid format");
                System.exit(1);
                throw new IllegalStateException();
            }
        };
    }

    private static AclfNetwork createIeeeAclfNet(String filePath) throws Exception {
        return IpssAdapter.importAclfNet(filePath)
                .setFormat(IEEECommonFormat)
                .load()
                .getImportedObj();
    }

    private static AclfNetwork createPsseAclfNet(String filePath) throws Exception {
        PsseVersion psseVersion = IpssAdapter.parsePsseVersion(filePath);
        return IpssAdapter.importAclfNet(filePath)
                .setFormat(PSSE)
                .setPsseVersion(psseVersion)
                .load()
                .getImportedObj();
    }

    // TODO: put the runAclf in a separate file
    private static void runAclf(ProjectPaths paths, String inputRelative, AclfNetwork net,
            Path resultsDir, String stem) throws Exception {
        LoadflowAlgorithm algo = LoadflowAlgoObjectFactory.createLoadflowAlgorithm(net);

        Path configPath = paths.resolveAclfRunConfig(inputRelative);
        System.out.println("Using config file: " + configPath);
        AclfRunConfigRec aclfRunConfig = AclfRunConfigRec.loadAclfRunConfig(configPath.toString());
        aclfRunConfig.configAclfRun(
                algo,
                aclfRunConfig.polarCoordinate,
                aclfRunConfig.includeAdjustments,
                false);

        algo.loadflow();

        Files.writeString(
                resultsDir.resolve(stem + "_network_info.txt"),
                IpssNetworkInfo.format(net),
                StandardCharsets.UTF_8);

        AclfNetDFrameAdapter dfAdapter = new AclfNetDFrameAdapter();
        dfAdapter.adapt(net);

        Csv.saver().save(dfAdapter.getDfBus(), resultsDir.resolve(stem + "_DF_bus.csv").toString());
        Csv.saver().save(dfAdapter.getDfGen(), resultsDir.resolve(stem + "_DF_gen.csv").toString());
        Csv.saver().save(dfAdapter.getDfLoad(), resultsDir.resolve(stem + "_DF_load.csv").toString());
        Csv.saver().save(dfAdapter.getDfBranch(), resultsDir.resolve(stem + "_DF_branch.csv").toString());
    }

    // TODO: put the runCa in a separate file
    private static void runCa(ProjectPaths paths, CliArgs cli, AclfNetwork net,
            Path resultsDir, String stem) throws Exception {
        if (cli.contFile == null || cli.monitorFile == null) {
            System.err.println("Contingency analysis requires cont_file and monitor_file arguments.");
            printUsage();
            System.exit(1);
        }

        ContingencyAnalysisAlgorithm algo = createContingencyAnalysisAlgorithm(net);
        algo.calculateDclf(DclfMethod.INC_LOSS);

        Path contPath = paths.resolveWspace(cli.contFile);
        Path monPath = paths.resolveWspace(cli.monitorFile);
        if (!Files.isRegularFile(contPath)) {
            System.err.println("Contingency file not found: " + contPath);
            System.exit(1);
        }
        if (!Files.isRegularFile(monPath)) {
            System.err.println("Monitor file not found: " + monPath);
            System.exit(1);
        }

        List<BranchContingencyRecord> contingencRecs =
                ContingencyFileUtil.importContingenciesFromJson(new File(contPath.toString()));
        List<DclfBranchOutage> dclfContList = new DclfContingencyHelper(algo).createDclfContList(contingencRecs);

        List<MonitoredBranchRecord> monitoredBranches =
                ContingencyFileUtil.importMonitoredBranchRecordsFromJson(new File(monPath.toString()));
        Set<String> monitoredBranchIds = monitoredBranches.stream()
                .map(MonitoredBranchRecord::getBranchId)
                .collect(Collectors.toCollection(HashSet::new));

        DclfContingencyConfig dclfConfig = new DclfContingencyConfig();
        dclfConfig.setDclfInclLoss(true);
        dclfConfig.setOverloadThreshold(90);

        int threads = Runtime.getRuntime().availableProcessors();
        System.out.println("Using " + threads + " threads for contingency analysis");

        ConcurrentLinkedQueue<BranchCAResultRec> results =
                ParallelDclfContingencyAnalyzer.performContingencyAnalysis(
                        net,
                        dclfContList,
                        monitoredBranchIds,
                        dclfConfig.getOverloadThreshold(),
                        dclfConfig.isDclfInclLoss(),
                        threads);

        DclfContingencyDFrameAdapter dfAdapter = new DclfContingencyDFrameAdapter();
        DataFrame dfCaRec = dfAdapter.adapt(results);
        Csv.saver().save(dfCaRec, resultsDir.resolve(stem + "_DF_contingency.csv").toString());
    }

    private static void printUsage() {
        System.err.println("Usage: IpssCmd <simutype> <format> <input> [<cont_file> <monitor_file>]");
        System.err.println("  simutype: aclf | ca");
        System.err.println("  format:   ieee | psse");
        System.err.println("  paths are relative to wspace/");
    }

    // TODO: put the CliArgs in a separate file
    private record CliArgs(String simutype, String format, String input, String contFile, String monitorFile) {

        static CliArgs parse(String[] args) {
            if (args.length < 3) {
                printUsage();
                System.exit(1);
            }
            String simutype = args[0];
            String format = args[1];
            String input = args[2];
            String contFile = args.length > 3 ? args[3] : null;
            String monitorFile = args.length > 4 ? args[4] : null;

            if (!simutype.equals("aclf") && !simutype.equals("ca")) {
                System.err.println("Invalid simulation type: " + simutype);
                printUsage();
                System.exit(1);
            }
            if (!format.equals("ieee") && !format.equals("psse")) {
                System.err.println("Invalid format: " + format);
                printUsage();
                System.exit(1);
            }
            return new CliArgs(simutype, format, input, contFile, monitorFile);
        }
    }
}
