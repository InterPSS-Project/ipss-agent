package org.interpss.agent.runner;

import static com.interpss.core.DclfAlgoObjectFactory.createContingencyAnalysisAlgorithm;

import java.io.File;
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

    public static void run(ProjectPaths paths, CliArgs cli, AclfNetwork net,
            Path resultsDir, String stem) throws Exception {
        if (cli.contFile() == null || cli.monitorFile() == null) {
            System.err.println("Contingency analysis requires cont_file and monitor_file arguments.");
            CliArgs.printUsage();
            System.exit(1);
        }

        ContingencyAnalysisAlgorithm algo = createContingencyAnalysisAlgorithm(net);
        algo.calculateDclf(DclfMethod.INC_LOSS);

        Path contPath = paths.resolveWspace(cli.contFile());
        Path monPath = paths.resolveWspace(cli.monitorFile());
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
}
