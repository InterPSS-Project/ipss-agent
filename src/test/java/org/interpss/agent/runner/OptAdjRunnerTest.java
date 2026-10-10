package org.interpss.agent.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.runner.config.OptAdjRunConfig;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.agent.util.ProjectPaths;
import org.interpss.numeric.datatype.LimitType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.interpss.core.aclf.AclfBranch;
import com.interpss.core.aclf.AclfNetwork;

/**
 * The OptAdj runner on the IEEE 39 fixture of {@code docs/gen_opt_adjustment.md}. The fixture's
 * ratings and generator P limits are applied here (the doc's {@code IEEE39_Sample_Data} does the
 * same in Java), because a case that carries neither is refused rather than silently adjusted.
 */
class OptAdjRunnerTest {

    @TempDir
    Path tempDir;

    private ProjectPaths paths;
    private Path caseFilePath;
    private Path resultsDir;
    private String stem;

    @BeforeEach
    void setUp() throws Exception {
        paths = AgentTestSupport.createProjectLayout(tempDir);
        AgentTestSupport.setupIeee39Case(paths);
        caseFilePath = paths.resolveWspace(AgentTestSupport.IEEE39_INPUT);
        resultsDir = paths.resultsDir(AgentTestSupport.IEEE39_INPUT);
        stem = ProjectPaths.outputStem(AgentTestSupport.IEEE39_INPUT);
    }

    /** The LP dereferences every control gen's P limit: a null one must be refused, not NPE. */
    @Test
    void runOnNet_rejectsAGeneratorWithoutAPGenLimit() throws Exception {
        AclfNetwork net = load();
        applyRatings(net);

        assertThatThrownBy(() -> OptAdjRunner.runOnNet(net, resultsDir, stem, null, basecase()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("have no P gen limit");
    }

    /** The scan divides by rating MVA 1, so an unrated case would read as infinite loading. */
    @Test
    void runOnNet_rejectsACaseWithoutBranchRatings() throws Exception {
        AclfNetwork net = load();
        applyGenLimits(net);

        assertThatThrownBy(() -> OptAdjRunner.runOnNet(net, resultsDir, stem, null, basecase()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("no rating MVA 1");
    }

    @Test
    void runOnNet_basecaseRedispatchesAndWritesBothCsvs() throws Exception {
        AclfNetwork net = load();
        applyFixture(net);

        OptAdjRunner.OptAdjSummary summary =
                OptAdjRunner.runOnNet(net, resultsDir, stem, null, basecase());

        assertThat(summary.optAdjType()).isEqualTo(OptAdjRunConfig.GEN_ADJ_BASE_CASE);
        assertThat(summary.scanThreshold()).isEqualTo(50.0);
        assertThat(summary.optAdjThreshold()).isEqualTo(100.0);
        assertThat(summary.contingencies()).isZero();
        assertThat(summary.scanned()).isPositive();
        assertThat(summary.overLimitBefore()).isPositive();
        assertThat(summary.gensAdjusted()).isPositive();
        // The redispatch may not clear every overload (gen limits), but it must not make it worse.
        assertThat(summary.overLimitAfter()).isLessThanOrEqualTo(summary.overLimitBefore());
        assertThat(summary.controlGens()).isPositive();
        assertThat(summary.gensWithoutPLimit()).isZero();

        Path genCsv = resultsDir.resolve(summary.genCsv());
        Path branchCsv = resultsDir.resolve(summary.branchCsv());
        // The basecase mode keeps the un-suffixed pair.
        assertThat(summary.genCsv()).isEqualTo(stem + "_DF_optadj_gen.csv");
        assertThat(summary.branchCsv()).isEqualTo(stem + "_DF_optadj_branch.csv");
        assertThat(genCsv).exists().content().isNotEmpty();
        assertThat(branchCsv).exists().content().isNotEmpty();
        String genHeader = Files.readString(genCsv).lines().findFirst().orElse("");
        String branchHeader = Files.readString(branchCsv).lines().findFirst().orElse("");
        assertThat(genHeader).contains("genName").contains("genP").contains("adjP")
                .contains("limitMax").contains("limitMin");
        assertThat(branchHeader).contains("branchId").contains("loadingBeforePct")
                .contains("loadingAfterPct").contains("shiftedFlowMWAfter");

        System.out.println(summary);
    }

    @Test
    void runOnNet_n1ScanScansTheN1OutageList() throws Exception {
        AclfNetwork net = load();
        applyFixture(net);

        OptAdjRunner.OptAdjSummary summary = OptAdjRunner.runOnNet(net, resultsDir, stem, null,
                new OptAdjRunConfig(OptAdjRunConfig.GEN_ADJ_CA_N1, 90.0, 100.0));

        assertThat(summary.optAdjType()).isEqualTo(OptAdjRunConfig.GEN_ADJ_CA_N1);
        assertThat(summary.scanThreshold()).isEqualTo(90.0);
        // Every branch not connected to the reference bus is an outage (the doc's 45).
        assertThat(summary.contingencies()).isEqualTo(45);
        assertThat(summary.scanned()).isPositive();
        assertThat(summary.overLimitAfter()).isLessThanOrEqualTo(summary.overLimitBefore());
        // The N-1 mode carries the `N1` infix in both names (0.7.5), so it cannot overwrite a
        // basecase pair in the same result folder.
        assertThat(summary.genCsv()).isEqualTo(stem + "_DF_optadj_N1_gen.csv");
        assertThat(summary.branchCsv()).isEqualTo(stem + "_DF_optadj_N1_branch.csv");
        assertThat(resultsDir.resolve(summary.branchCsv())).exists().content().isNotEmpty();
        assertThat(resultsDir.resolve(summary.genCsv())).exists().content().isNotEmpty();
        assertThat(resultsDir.resolve(stem + "_DF_optadj_gen.csv")).doesNotExist();
        assertThat(resultsDir.resolve(stem + "_DF_optadj_branch.csv")).doesNotExist();

        System.out.println(summary);
    }

    @Test
    void runOnNet_rejectsAContingencyFileInBasecaseMode() throws Exception {
        AclfNetwork net = load();
        applyFixture(net);

        assertThatThrownBy(() -> OptAdjRunner.runOnNet(net, resultsDir, stem,
                tempDir.resolve("contingencies.json"), basecase()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("has no contingencies");
    }

    /** Nothing above the scan threshold: no LP call, header-only CSVs, no failure. */
    @Test
    void runOnNet_anEmptyScanStillWritesBothCsvs() throws Exception {
        AclfNetwork net = load();
        applyFixture(net);

        OptAdjRunner.OptAdjSummary summary = OptAdjRunner.runOnNet(net, resultsDir, stem, null,
                new OptAdjRunConfig(OptAdjRunConfig.GEN_ADJ_BASE_CASE, 250.0, 100.0));

        assertThat(summary.scanned()).isZero();
        assertThat(summary.overLimitBefore()).isZero();
        assertThat(summary.gensAdjusted()).isZero();
        assertThat(Files.readString(resultsDir.resolve(summary.branchCsv()))).contains("branchId");
        assertThat(Files.readString(resultsDir.resolve(summary.genCsv()))).contains("genName");
    }

    private OptAdjRunConfig basecase() {
        return new OptAdjRunConfig(OptAdjRunConfig.GEN_ADJ_BASE_CASE, 50.0, 100.0);
    }

    private AclfNetwork load() throws Exception {
        return NetworkLoader.loadNetwork("ieee", caseFilePath.toString());
    }

    /** The doc's fixture: gen P limits plus the branch ratings. */
    private static void applyFixture(AclfNetwork net) {
        applyGenLimits(net);
        applyRatings(net);
    }

    /** Mirrors {@code IEEE39_Sample_Data.createTestCaseNetwork}'s gen limits. */
    private static void applyGenLimits(AclfNetwork net) {
        net.getBusList().forEach(bus -> {
            if (bus.getGenP() == 0.0) {
                bus.getContributeGenList().clear();
            }
        });
        net.createAclfGenUIDLookupTable(true).values().forEach(gen -> {
            if ("Bus39-G1".equals(gen.getName())) {
                gen.setPGenLimit(new LimitType(10.0, 0.0));
            } else if ("Bus38-G1".equals(gen.getName())) {
                gen.setPGenLimit(new LimitType(8.3, 0.0));
            } else {
                gen.setPGenLimit(new LimitType(7.0, 0.0));
            }
        });
    }

    /** Mirrors {@code scripts/ieee39_limit_setup.gvy}: lines 600 MVA, transformers 800 MVA. */
    private static void applyRatings(AclfNetwork net) {
        net.getBranchList().forEach(branch -> {
            AclfBranch aclfBranch = (AclfBranch) branch;
            aclfBranch.setRatingMva1(aclfBranch.isLine() ? 600.0 : 800.0);
        });
    }
}
