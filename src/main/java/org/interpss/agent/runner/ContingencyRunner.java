package org.interpss.agent.runner;

import static com.interpss.core.DclfAlgoObjectFactory.createCaOutageBranch;
import static com.interpss.core.DclfAlgoObjectFactory.createContingency;
import static com.interpss.core.DclfAlgoObjectFactory.createContingencyAnalysisAlgorithm;
import static org.dflib.Exp.$double;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.stream.Collectors;

import org.dflib.DataFrame;
import org.dflib.csv.Csv;
import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.util.CaRunConfig;
import org.interpss.agent.util.ProjectPaths;
import org.interpss.plugin.contingency.DclfContingencyConfig;
import org.interpss.plugin.contingency.ParallelDclfContingencyAnalyzer;
import org.interpss.plugin.contingency.definition.BranchContingencyRecord;
import org.interpss.plugin.contingency.definition.MonitoredBranchRecord;
import org.interpss.plugin.contingency.util.ContingencyFileUtil;
import org.interpss.plugin.contingency.util.DclfContingencyHelper;
import org.interpss.plugin.result.dframe.ca.DclfContingencyDFrameAdapter;

import com.interpss.algo.parallel.BranchCAResultRec;
import com.interpss.core.aclf.AclfBranch;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.dclf.ContingencyAnalysisAlgorithm;
import com.interpss.core.algo.dclf.DclfMethod;
import com.interpss.core.contingency.ContingencyBranchOutageType;
import com.interpss.core.contingency.dclf.DclfBranchOutage;
import com.interpss.core.contingency.dclf.DclfOutageBranch;

/**
 * Runs DC contingency analysis and writes contingency CSV results.
 */
public final class ContingencyRunner {

    private ContingencyRunner() {
    }

    public static ContAnalysisSummary run(ProjectPaths paths, CliArgs cli, String caseFilePath,
            Path resultsDir, String stem) throws Exception {
        AclfNetwork net = NetworkLoader.loadNetwork(cli.format(), caseFilePath);
        return run(paths, cli, net, resultsDir, stem);
    }

    public static ContAnalysisSummary run(ProjectPaths paths, CliArgs cli, AclfNetwork net,
            Path resultsDir, String stem) throws Exception {
        ValidatedContingencyInputs inputs = resolveInputs(paths, cli);
        return runOnNet(net, resultsDir, stem, inputs.contPath(), inputs.monitorPath());
    }

    /**
     * In-process core: run DC contingency analysis on an already-loaded
     * {@code net} using optional absolute {@code contPath}/{@code monitorPath},
     * then write {@code stem_DF_contingency.csv}. Shared by the CLI
     * ({@code IpssCmd}) and the in-process bridge ({@code IpssAgentBridge}).
     * <p>
     * When {@code contPath} is null, builds an N-1 OPEN outage list for every
     * branch not connected to the reference bus. When {@code monitorPath} is
     * null, monitors all network branch ids.
     */
    public static ContAnalysisSummary runOnNet(AclfNetwork net, Path resultsDir, String stem,
            Path contPath, Path monitorPath) throws Exception {
        ContingencyAnalysisAlgorithm algo = createContingencyAnalysisAlgorithm(net);
        algo.calculateDclf(DclfMethod.INC_LOSS);

        List<DclfBranchOutage> dclfContList;
        if (contPath != null) {
            List<BranchContingencyRecord> contingencRecs =
                    ContingencyFileUtil.importContingenciesFromJson(contPath.toFile());
            dclfContList = new DclfContingencyHelper(algo).createDclfContList(contingencRecs);
        } else {
            dclfContList = createN1BranchOutageList(algo);
        }

        Set<String> monitoredBranchIds;
        if (monitorPath != null) {
            List<MonitoredBranchRecord> monitoredBranches =
                    ContingencyFileUtil.importMonitoredBranchRecordsFromJson(monitorPath.toFile());
            monitoredBranchIds = monitoredBranches.stream()
                    .map(MonitoredBranchRecord::getBranchId)
                    .collect(Collectors.toCollection(HashSet::new));
        } else {
            monitoredBranchIds = net.getBranchList().stream()
                    .map(branch -> branch.getId())
                    .collect(Collectors.toCollection(HashSet::new));
        }

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

        return new ContAnalysisSummary(dclfConfig.getOverloadThreshold(),
                dclfContList.size(),
                monitoredBranchIds.size(),
                dfCaRec.height());
                    
    }

    /**
     * N-1 OPEN outages for every branch not connected to the reference bus
     * (IEEE39 OptN1Scan pattern).
     */
    private static List<DclfBranchOutage> createN1BranchOutageList(
            ContingencyAnalysisAlgorithm algo) {
        List<DclfBranchOutage> contList = new ArrayList<>();
        algo.getAclfNet().getBranchList().stream()
                .filter(branch -> !((AclfBranch) branch).isConnect2RefBus())
                .forEach(branch -> {
                    DclfBranchOutage cont = createContingency("contBranch:" + branch.getId());
                    DclfOutageBranch outage = createCaOutageBranch(
                            algo.getDclfAlgoBranch(branch.getId()),
                            ContingencyBranchOutageType.OPEN);
                    cont.setOutageEquip(outage);
                    contList.add(cont);
                });
        return contList;
    }

    /**
     * Resolve optional contingency/monitor files. A null CLI arg yields a null
     * path (defaults applied in {@link #runOnNet}); a provided path must exist.
     */
    public static ValidatedContingencyInputs validateInputs(ProjectPaths paths, CliArgs cli) {
        Path contPath = null;
        if (cli.contFile() != null) {
            contPath = paths.resolveWspace(cli.contFile());
            if (!Files.isRegularFile(contPath)) {
                throw new IllegalStateException("Contingency file not found: " + contPath);
            }
        }

        Path monPath = null;
        if (cli.monitorFile() != null) {
            monPath = paths.resolveWspace(cli.monitorFile());
            if (!Files.isRegularFile(monPath)) {
                throw new IllegalStateException("Monitor file not found: " + monPath);
            }
        }
        return new ValidatedContingencyInputs(contPath, monPath);
    }

    /**
     * Resolve the contingency/monitor files for a run. Explicit CLI arguments
     * win and must exist; otherwise the case-folder {@code ca_run.json} supplies
     * the {@code custom} entries; otherwise both are null and the built-in
     * defaults apply (N-1 outages, all branches monitored). The GUI tab writes
     * the same file, so both entry points agree.
     */
    public static ValidatedContingencyInputs resolveInputs(ProjectPaths paths, CliArgs cli) {
        ValidatedContingencyInputs explicit = validateInputs(paths, cli);

        Path configFile = paths.caseCaRunConfig(cli.input());
        if (!Files.isRegularFile(configFile)) {
            return explicit;
        }

        CaRunConfig config;
        try {
            config = CaRunConfig.load(configFile);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + configFile + ": " + e.getMessage(), e);
        }
        System.out.println("Using ca_run.json: " + configFile);

        Path contPath = explicit.contPath() != null ? explicit.contPath()
                : resolveConfigEntry(paths, configFile, config.contingencyInput(),
                        config.contingencyIsCustom(), "contingencyFile", "custom contingencies");
        Path monitorPath = explicit.monitorPath() != null ? explicit.monitorPath()
                : resolveConfigEntry(paths, configFile, config.monitoredBranchInput(),
                        config.monitorIsCustom(), "monitoredBranchFile", "custom monitored branches");
        return new ValidatedContingencyInputs(contPath, monitorPath);
    }

    /**
     * One {@code ca_run.json} entry: {@code null} when its mode is {@code all},
     * otherwise an existing path under {@code wspace/}.
     */
    private static Path resolveConfigEntry(ProjectPaths paths, Path configFile, String value,
            boolean custom, String key, String label) {
        if (!custom) {
            return null;
        }
        if (value == null) {
            throw new IllegalStateException(configFile + " selects " + label + " but names no " + key);
        }
        Path candidate = wspaceRelative(paths, configFile, key, value);
        if (!Files.isRegularFile(candidate)) {
            throw new IllegalStateException(key + " not found: " + candidate + " (from " + configFile + ")");
        }
        return candidate;
    }

    /** Reject absolute and escaping values so a config file cannot point outside {@code wspace/}. */
    private static Path wspaceRelative(ProjectPaths paths, Path configFile, String key, String value) {
        String normalized = value.replace('\\', '/');
        if (normalized.startsWith("/") || normalized.contains("..")) {
            throw new IllegalStateException(
                    configFile + ": " + key + " must be a path under wspace/ (got '" + value + "')");
        }
        Path resolved = paths.resolveWspace(normalized);
        if (!resolved.startsWith(paths.wspaceDir())) {
            throw new IllegalStateException(
                    configFile + ": " + key + " escapes wspace/ (got '" + value + "')");
        }
        return resolved;
    }

    public record ValidatedContingencyInputs(Path contPath, Path monitorPath) {
    }

    public static record ContAnalysisSummary(double threshold, 
        int numCont,        // number of contingencies applied
        int numMonitored, // number of monitored branches
        int numOverloads) { // number of overloads
        public String toString() {
                return "ContAnalysisSummary:\n" + 
                "Threshold=" + threshold + "\n" +
                "Contingencies=" + numCont + "\n" +
                "Monitored Branches=" + numMonitored + "\n" +
                "Overloading Branches=" + numOverloads + "\n";
    }
}
}
