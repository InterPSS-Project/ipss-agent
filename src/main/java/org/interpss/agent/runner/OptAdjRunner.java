package org.interpss.agent.runner;

import static com.interpss.core.DclfAlgoObjectFactory.createContingencyAnalysisAlgorithm;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.dflib.DataFrame;
import org.dflib.csv.Csv;
import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.runner.config.OptAdjRunConfig;
import org.interpss.agent.util.ProjectPaths;
import org.interpss.plugin.contingency.definition.BranchContingencyRecord;
import org.interpss.plugin.contingency.util.ContingencyFileUtil;
import org.interpss.plugin.contingency.util.DclfContingencyHelper;

import com.interpss.core.aclf.AclfBranch;
import com.interpss.core.aclf.AclfGen;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.dclf.ContingencyAnalysisAlgorithm;
import com.interpss.core.algo.dclf.DclfMethod;
import com.interpss.core.algo.dclf.solver.IDclfSolver;
import com.interpss.core.contingency.dclf.DclfBranchOutage;
import com.interpss.core.funcImpl.dclf.AclfNetSsaHelper;
import com.interpss.core.net.Branch;
import com.interpss.optadj.algo.lf.AclfNetContigencyOptimizer;
import com.interpss.optadj.algo.lf.AclfNetLoadFlowOptimizer;
import com.interpss.optadj.result.OptAdjResultContainer;
import com.interpss.optadj.result.OptAdjResultContainer.GenAdjustResult;
import com.interpss.optadj.result.SsaBranchOverLimitInfo;
import com.interpss.optadj.result.SsaResultContainer;

/**
 * Generator redispatch for thermal limits (OptAdj): an SSA scan collects the branches (or
 * post-contingency pairs) above a scan threshold, a linear program redispatches the control
 * generators so the monitored loadings stay under a percent-of-rating threshold, and the same
 * monitored set is re-scanned after the adjustment.
 * <p>
 * The method, its prerequisites and the two regression anchors are documented in
 * {@code docs/gen_opt_adjustment.md}; this runner is the CLI/bridge entry point of the two
 * {@code org.interpss.sample.optadj} samples. Two differences from the samples are deliberate:
 * the worker count is configurable ({@code OptAdjRunConfig.threads}, {@code 0} = one per available
 * processor, which {@code AclfNetSsaHelper} applies itself), and a case whose generators carry no
 * P gen limit is refused before the optimizer runs — the library's constraint builder dereferences
 * {@code getPGenLimit()} without a null check, so the alternative is an opaque
 * {@code NullPointerException} halfway through the LP.
 * <p>
 * The adjustment is applied to the {@code AclfNetwork} the caller passes in (the DCLF model's gen
 * P is overwritten), so a second run continues from the redispatched state.
 */
public final class OptAdjRunner {

    private OptAdjRunner() {
    }

    public static OptAdjSummary run(ProjectPaths paths, CliArgs cli, String caseFilePath,
            Path resultsDir, String stem) throws Exception {
        AclfNetwork net = NetworkLoader.loadNetwork(cli.format(), caseFilePath);
        ValidatedOptAdjInputs inputs = resolveInputs(paths, cli);
        return runOnNet(net, resultsDir, stem, inputs.contPath(), inputs.config());
    }

    /**
     * In-process core: run the OptAdj flow on an already-loaded {@code net} and write
     * {@code stem_DF_optadj_gen.csv} (one row per adjusted generator) and
     * {@code stem_DF_optadj_branch.csv} (one row per scanned entry, before and after).
     * Shared by the CLI ({@code IpssCmd}) and the in-process bridge ({@code IpssAgentBridge}).
     * <p>
     * A non-null {@code contPath} is only meaningful for
     * {@link OptAdjRunConfig#GEN_ADJ_CA_N1}; the basecase mode has no contingencies and rejects
     * one rather than ignoring it.
     */
    public static OptAdjSummary runOnNet(AclfNetwork net, Path resultsDir, String stem,
            Path contPath, OptAdjRunConfig config) throws Exception {
        OptAdjRunConfig cfg = config == null ? OptAdjRunConfig.DEFAULT : config;
        if (contPath != null && !cfg.isCaN1()) {
            throw new IllegalStateException("a basecase OptAdj run has no contingencies: use optAdjType '"
                    + OptAdjRunConfig.GEN_ADJ_CA_N1 + "' or drop the contingency file");
        }

        List<AclfGen> gensWithLimits = gensWithPLimit(net);
        List<String> missing = gensWithoutPLimit(net);
        if (!missing.isEmpty()) {
            throw new IllegalStateException(missing.size() + " generator(s) have no P gen limit: "
                    + String.join(", ", missing.subList(0, Math.min(5, missing.size())))
                    + (missing.size() > 5 ? ", …" : "")
                    + " — apply the case's generator limit script (the ieee39"
                    + " scripts/ieee39_limit_setup.gvy pattern) before running OptAdj");
        }

        // The SSA scan measures loading against every branch's rating MVA 1
        // (`Math.abs(flow / getRatingMvaA()) * 100`), so an unrated branch would read as
        // infinite loading and the LP would try to relieve it. Refuse rather than
        // compute a meaningless redispatch.
        List<String> unrated = branchesWithoutRatingMva1(net);
        if (!unrated.isEmpty()) {
            throw new IllegalStateException(unrated.size() + " branch(es) have no rating MVA 1 (LimMvaA): "
                    + String.join(", ", unrated.subList(0, Math.min(5, unrated.size())))
                    + (unrated.size() > 5 ? ", …" : "")
                    + " — the OptAdj scan measures loading against rating MVA 1, so rate the branches"
                    + " first (the ieee39 scripts/ieee39_limit_setup.gvy pattern)");
        }

        ContingencyAnalysisAlgorithm algo = createContingencyAnalysisAlgorithm(net,
                IDclfSolver.CacheType.SenNotCached, true);
        algo.calculateDclf(DclfMethod.INC_LOSS);

        List<DclfBranchOutage> contList = null;
        if (cfg.isCaN1()) {
            contList = contPath != null
                    ? dclfContList(algo, contPath)
                    : ContingencyRunner.n1BranchOutageList(algo);
        }

        AclfNetSsaHelper ssaHelper = new AclfNetSsaHelper(algo, cfg.threadsOrDefault());
        double scanThreshold = cfg.scanLoadingThresholdOrDefault();
        double optAdjThreshold = cfg.optAdjLoadingThresholdOrDefault();
        SsaResultContainer scanned = cfg.isCaN1()
                ? ssaHelper.contingencyScan(contList, scanThreshold)
                : ssaHelper.baseCaseScan(scanThreshold);
        List<SsaBranchOverLimitInfo> before = overLimitInfo(scanned, cfg.isCaN1());
        requireFiniteLoadings(before);

        // Nothing above the scan threshold means there is no constraint to relieve: skip the LP
        // (an empty section-constraint set has nothing to optimize) and still write both CSVs.
        Map<String, GenAdjustResult> adjustments = Map.of();
        Map<String, SsaBranchOverLimitInfo> after = new LinkedHashMap<>();
        if (!before.isEmpty()) {
            OptAdjResultContainer optAdjResult = new OptAdjResultContainer(scanned);
            Map<String, GenAdjustResult> optimized = cfg.isCaN1()
                    ? new AclfNetContigencyOptimizer(true).optimize(algo, optAdjResult, optAdjThreshold)
                    : new AclfNetLoadFlowOptimizer(true).optimize(algo, optAdjResult, optAdjThreshold);
            adjustments = optimized != null
                    ? optimized
                    : (optAdjResult.getOptAdjResults() == null ? Map.of() : optAdjResult.getOptAdjResults());

            // Re-evaluate the SAME monitored set after the redispatch (the doc's post-opt anchors).
            algo.calculateDclf(DclfMethod.INC_LOSS);
            SsaResultContainer rescanned = cfg.isCaN1()
                    ? ssaHelper.contingencyScan(contList, before)
                    : ssaHelper.calBaseCaseLoading(before);
            for (SsaBranchOverLimitInfo entry : overLimitInfo(rescanned, cfg.isCaN1())) {
                after.put(entryKey(entry), entry);
            }
        }

        Files.createDirectories(resultsDir);
        String genCsv = stem + "_DF_optadj_gen.csv";
        String branchCsv = stem + "_DF_optadj_branch.csv";
        Csv.saver().save(genFrame(adjustments), resultsDir.resolve(genCsv).toString());
        Csv.saver().save(branchFrame(before, after, cfg.isCaN1()), resultsDir.resolve(branchCsv).toString());

        int gensAdjusted = 0;
        for (GenAdjustResult result : adjustments.values()) {
            if (result != null && Math.abs(result.adjP()) > 1e-6) {
                gensAdjusted++;
            }
        }
        OptAdjSummary summary = new OptAdjSummary(cfg.optAdjTypeOrDefault(), scanThreshold, optAdjThreshold,
                contList == null ? 0 : contList.size(),
                before.size(),
                countAtOrAbove(before, optAdjThreshold),
                countAtOrAbove(new ArrayList<>(after.values()), optAdjThreshold),
                gensWithLimits.size(),
                gensAdjusted,
                0,
                genCsv,
                branchCsv);
        System.out.println(summary);
        return summary;
    }

    /**
     * Effective run config for a CLI run: the case's {@code config/opt_adj_run.json} unless the
     * CLI names a contingency file, which pins the {@code custom} mode to that file.
     */
    public static ValidatedOptAdjInputs resolveInputs(ProjectPaths paths, CliArgs cli) {
        Path explicitCont = null;
        if (cli.contFile() != null) {
            explicitCont = paths.resolveWspace(cli.contFile());
            if (!Files.isRegularFile(explicitCont)) {
                throw new IllegalStateException("Contingency file not found: " + explicitCont);
            }
        }

        Path configFile = paths.caseOptAdjRunConfig(cli.input());
        OptAdjRunConfig config = OptAdjRunConfig.DEFAULT;
        if (Files.isRegularFile(configFile)) {
            try {
                config = OptAdjRunConfig.load(configFile);
            } catch (IOException e) {
                throw new IllegalStateException("Cannot read " + configFile + ": " + e.getMessage(), e);
            }
            System.out.println("Using opt_adj_run.json: " + configFile);
        }

        if (explicitCont != null) {
            config = new OptAdjRunConfig(config.optAdjType(), config.scanLoadingThreshold(),
                    config.optAdjLoadingThreshold(), OptAdjRunConfig.CUSTOM, cli.contFile(), config.threads());
            return new ValidatedOptAdjInputs(explicitCont, config);
        }
        Path contPath = ContingencyRunner.resolveConfigEntry(paths, configFile, config.contingencyInput(),
                config.contingencyIsCustom(), "contingencyFile", "custom contingencies");
        return new ValidatedOptAdjInputs(contPath, config);
    }

    /** The contingency list a {@code custom} N-1 run scans, from the same JSON CA reads. */
    private static List<DclfBranchOutage> dclfContList(ContingencyAnalysisAlgorithm algo, Path contPath)
            throws Exception {
        List<BranchContingencyRecord> records =
                ContingencyFileUtil.importContingenciesFromJson(contPath.toFile());
        return new DclfContingencyHelper(algo).createDclfContList(records);
    }

    /** The container's own list for the mode (basecase entries or outage/monitored pairs). */
    private static List<SsaBranchOverLimitInfo> overLimitInfo(SsaResultContainer container, boolean caN1) {
        if (container == null) {
            return new ArrayList<>();
        }
        List<SsaBranchOverLimitInfo> list = caN1 ? container.getCaOverLimitInfo() : container.getBaseOverLimitInfo();
        return list == null ? new ArrayList<>() : list;
    }

    /** One scanned entry as a key: monitored branch plus (N-1) the outage it belongs to. */
    private static String entryKey(SsaBranchOverLimitInfo entry) {
        String outage = entry.getOutageBranchId();
        return entry.getOverLimitBranchId() + "|" + (outage == null ? "" : outage);
    }

    private static int countAtOrAbove(List<SsaBranchOverLimitInfo> entries, double threshold) {
        int count = 0;
        for (SsaBranchOverLimitInfo entry : entries) {
            if (entry != null && entry.getLoadingPercent() >= threshold) {
                count++;
            }
        }
        return count;
    }

    /** Active generators that carry a P gen limit — the LP's control candidates. */
    private static List<AclfGen> gensWithPLimit(AclfNetwork net) {
        List<AclfGen> gens = new ArrayList<>();
        net.createAclfGenUIDLookupTable(true).values().stream()
                .filter(AclfGen::isActive)
                .filter(gen -> gen.getPGenLimit() != null)
                .forEach(gens::add);
        return gens;
    }

    /** Names of the active generators the LP would dereference without a limit. */
    private static List<String> gensWithoutPLimit(AclfNetwork net) {
        List<String> names = new ArrayList<>();
        net.createAclfGenUIDLookupTable(true).values().stream()
                .filter(AclfGen::isActive)
                .filter(gen -> gen.getPGenLimit() == null)
                .forEach(gen -> names.add(gen.getName() == null ? gen.getId() : gen.getName()));
        return names;
    }

    /** Ids of the branches the scan could not measure: no rating MVA 1 to divide by. */
    private static List<String> branchesWithoutRatingMva1(AclfNetwork net) {
        List<String> ids = new ArrayList<>();
        for (Branch branch : net.getBranchList()) {
            if (branch instanceof AclfBranch aclfBranch && aclfBranch.getRatingMvaA() <= 0.0) {
                ids.add(aclfBranch.getId());
            }
        }
        return ids;
    }

    /**
     * A loading that is not finite means the scan divided by a rating the case does not carry.
     * The pre-check above already refuses such a case; this is the backstop that keeps an
     * {@code Infinity} out of the result CSVs.
     */
    private static void requireFiniteLoadings(List<SsaBranchOverLimitInfo> entries) {
        for (SsaBranchOverLimitInfo entry : entries) {
            if (entry != null && !Double.isFinite(entry.getLoadingPercent())) {
                throw new IllegalStateException("branch " + entry.getOverLimitBranchId()
                        + " has no usable rating: its loading could not be computed");
            }
        }
    }

    /** One row per generator the optimizer reported on, largest adjustment first. */
    private static DataFrame genFrame(Map<String, GenAdjustResult> adjustments) {
        List<Object[]> rows = new ArrayList<>();
        adjustments.entrySet().stream()
                .sorted((a, b) -> Double.compare(adjustmentMagnitude(b.getValue()),
                        adjustmentMagnitude(a.getValue())))
                .forEach(entry -> {
                    GenAdjustResult result = entry.getValue();
                    if (result == null) {
                        return;
                    }
                    rows.add(new Object[] {entry.getKey(), result.genP(), result.adjP(),
                            result.genLimit() == null ? null : result.genLimit().getMax(),
                            result.genLimit() == null ? null : result.genLimit().getMin()});
                });
        return DataFrame.byArrayRow(GEN_COLUMNS).ofIterable(rows);
    }

    private static double adjustmentMagnitude(GenAdjustResult result) {
        return result == null ? 0.0 : Math.abs(result.adjP());
    }

    /** One row per scanned entry: the pre-opt loading and the post-opt loading of the same entry. */
    private static DataFrame branchFrame(List<SsaBranchOverLimitInfo> before,
            Map<String, SsaBranchOverLimitInfo> after, boolean caN1) {
        List<Object[]> rows = new ArrayList<>();
        for (SsaBranchOverLimitInfo entry : before) {
            SsaBranchOverLimitInfo post = after.get(entryKey(entry));
            rows.add(new Object[] {entry.getOverLimitBranchId(),
                    caN1 ? entry.getOutageBranchId() : null,
                    entry.getLimitMW(), entry.getBaseFlowMW(), entry.getLoadingPercent(),
                    post == null ? null : post.getShftedFlowMW(),
                    post == null ? null : post.getLoadingPercent()});
        }
        return DataFrame.byArrayRow(BRANCH_COLUMNS).ofIterable(rows);
    }

    /** The gen CSV header, in this order (the columns the docs and the card name). */
    private static final String[] GEN_COLUMNS =
            {"genName", "genP", "adjP", "limitMax", "limitMin"};

    /** The branch-loading CSV header, in this order. */
    private static final String[] BRANCH_COLUMNS =
            {"branchId", "outageBranchId", "limitMW", "baseFlowMW", "loadingBeforePct",
                "shiftedFlowMWAfter", "loadingAfterPct"};

    /** The resolved contingency input plus the run config it came from. */
    public record ValidatedOptAdjInputs(Path contPath, OptAdjRunConfig config) {
    }

    /** What the run did, printed by the CLI and mirrored into the bridge's JSON reply. */
    public record OptAdjSummary(String optAdjType, double scanThreshold, double optAdjThreshold,
            int contingencies, int scanned, int overLimitBefore, int overLimitAfter,
            int controlGens, int gensAdjusted, int gensWithoutPLimit, String genCsv, String branchCsv) {

        @Override
        public String toString() {
            return "OptAdjSummary:\n"
                    + "Type=" + optAdjType + "\n"
                    + "Scan Threshold=" + scanThreshold + "\n"
                    + "OptAdj Threshold=" + optAdjThreshold + "\n"
                    + "Contingencies=" + contingencies + "\n"
                    + "Scanned Branches=" + scanned + "\n"
                    + "Over Limit Before=" + overLimitBefore + "\n"
                    + "Over Limit After=" + overLimitAfter + "\n"
                    + "Control Generators=" + controlGens + "\n"
                    + "Generators Adjusted=" + gensAdjusted + "\n"
                    + "Gen Adjustments=" + genCsv + "\n"
                    + "Branch Loadings=" + branchCsv;
        }
    }
}
