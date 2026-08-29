package org.interpss.agent.runner;

import static com.interpss.core.DclfAlgoObjectFactory.createContingencyAnalysisAlgorithm;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.stream.Collectors;

import org.dflib.DataFrame;
import org.dflib.csv.Csv;
import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.util.ProjectPaths;
import org.interpss.plugin.contingency.DclfContingencyConfig;
import org.interpss.plugin.contingency.ParallelDclfContingencyAnalyzer;
import org.interpss.plugin.contingency.definition.BranchContingencyRecord;
import org.interpss.plugin.contingency.definition.MonitoredBranchRecord;
import org.interpss.plugin.contingency.util.ContingencyFileUtil;
import org.interpss.plugin.contingency.util.DclfContingencyHelper;
import org.interpss.plugin.result.dframe.ca.DclfContingencyDFrameAdapter;

import com.interpss.algo.parallel.BranchCAResultRec;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.dclf.ContingencyAnalysisAlgorithm;
import com.interpss.core.algo.dclf.DclfMethod;
import com.interpss.core.contingency.dclf.DclfBranchOutage;

/**
 * Runs DC contingency analysis and writes contingency CSV results.
 */
public final class ContingencyRunner {

    private ContingencyRunner() {
    }

    public static void run(ProjectPaths paths, CliArgs cli, String caseFilePath,
            Path resultsDir, String stem) throws Exception {
        AclfNetwork net = NetworkLoader.loadNetwork(cli.format(), caseFilePath);
        run(paths, cli, net, resultsDir, stem);
    }

    public static void run(ProjectPaths paths, CliArgs cli, AclfNetwork net,
            Path resultsDir, String stem) throws Exception {
        ValidatedContingencyInputs inputs = validateInputs(paths, cli);
        runOnNet(net, resultsDir, stem, inputs.contPath(), inputs.monitorPath());
    }

    /**
     * In-process core: run DC contingency analysis on an already-loaded
     * {@code net} using absolute {@code contPath}/{@code monitorPath}, then
     * write {@code stem_DF_contingency.csv}. Shared by the CLI ({@code IpssCmd})
     * and the in-process bridge ({@code IpssAgentBridge}).
     */
    public static void runOnNet(AclfNetwork net, Path resultsDir, String stem,
            Path contPath, Path monitorPath) throws Exception {
        ContingencyAnalysisAlgorithm algo = createContingencyAnalysisAlgorithm(net);
        algo.calculateDclf(DclfMethod.INC_LOSS);

        List<BranchContingencyRecord> contingencRecs =
                ContingencyFileUtil.importContingenciesFromJson(contPath.toFile());
        List<DclfBranchOutage> dclfContList = new DclfContingencyHelper(algo).createDclfContList(contingencRecs);

        List<MonitoredBranchRecord> monitoredBranches =
                ContingencyFileUtil.importMonitoredBranchRecordsFromJson(monitorPath.toFile());
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

    public static ValidatedContingencyInputs validateInputs(ProjectPaths paths, CliArgs cli) {
        if (cli.contFile() == null || cli.monitorFile() == null) {
            throw new IllegalArgumentException(
                    "Contingency analysis requires cont_file and monitor_file arguments.");
        }

        Path contPath = paths.resolveWspace(cli.contFile());
        Path monPath = paths.resolveWspace(cli.monitorFile());
        if (!Files.isRegularFile(contPath)) {
            throw new IllegalStateException("Contingency file not found: " + contPath);
        }
        if (!Files.isRegularFile(monPath)) {
            throw new IllegalStateException("Monitor file not found: " + monPath);
        }
        return new ValidatedContingencyInputs(contPath, monPath);
    }

    public record ValidatedContingencyInputs(Path contPath, Path monitorPath) {
    }
}
