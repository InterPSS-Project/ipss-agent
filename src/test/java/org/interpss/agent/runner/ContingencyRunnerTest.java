package org.interpss.agent.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import com.interpss.core.algo.dclf.BranchRatingProvider;
import com.interpss.core.algo.dclf.DclfContingencyConfig;
import com.interpss.core.algo.dclf.DclfIslandingTreatment;
import com.interpss.core.algo.dclf.DclfMultiOutageReplayMode;
import com.interpss.core.algo.dclf.solver.DclfContingencySolutionMethod;

import org.interpss.agent.cli.CliArgs;
import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.agent.util.CaRunConfig;
import org.interpss.agent.util.ProjectPaths;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ContingencyRunnerTest {

    @TempDir
    Path tempDir;

    private ProjectPaths paths;
    private Path caseFilePath;
    private Path resultsDir;
    private String stem;
    private CliArgs cliArgs;

    @BeforeEach
    void setUp() throws Exception {
        paths = AgentTestSupport.createProjectLayout(tempDir);
        AgentTestSupport.setupIeee14Case(paths);
        caseFilePath = paths.resolveWspace(AgentTestSupport.IEEE14_INPUT);
        resultsDir = paths.resultsDir(AgentTestSupport.IEEE14_INPUT);
        stem = ProjectPaths.outputStem(AgentTestSupport.IEEE14_INPUT);
        cliArgs = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR);
    }

    @Test
    void run_writesContingencyCsv() throws Exception {
        ContingencyRunner.ContAnalysisSummary summary =
                ContingencyRunner.run(paths, cliArgs, caseFilePath.toString(), resultsDir, stem);

        Path csv = resultsDir.resolve(stem + "_DF_contingency.csv");
        assertThat(csv).exists().content().isNotEmpty();
        assertThat(summary.numOverloads()).isEqualTo(java.nio.file.Files.lines(csv).skip(1).count());
        // Must be row count, not DataFrame columnCount (11)
        assertThat(summary.numOverloads()).isNotEqualTo(11);
    }

    /** The violation-check loading the caller asks for is what the run reports. */
    @Test
    void runOnNet_honoursTheOverloadThreshold() throws Exception {
        var strict = IeeeFileAdapter.createAclfNet(caseFilePath.toString());
        ContingencyRunner.ContAnalysisSummary high =
                ContingencyRunner.runOnNet(strict, resultsDir, "strict", null, null, 100.0);
        assertThat(high.threshold()).isEqualTo(100.0);

        var loose = IeeeFileAdapter.createAclfNet(caseFilePath.toString());
        ContingencyRunner.ContAnalysisSummary low =
                ContingencyRunner.runOnNet(loose, resultsDir, "loose", null, null, 50.0);
        assertThat(low.threshold()).isEqualTo(50.0);
        // A lower threshold can only add overloading rows, never remove them.
        assertThat(low.numOverloads()).isGreaterThanOrEqualTo(high.numOverloads());
    }

    /** config/ca_run.json carries the threshold into a run that names no explicit files. */
    @Test
    void run_readsTheThresholdFromTheCaseConfig() throws Exception {
        Path configDir = paths.resolveWspace("data/ieee/Ieee14Bus/config");
        Files.createDirectories(configDir);
        Files.writeString(configDir.resolve("ca_run.json"),
                "{\"overloadThreshold\": 55}\n");
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ContAnalysisSummary summary =
                ContingencyRunner.run(paths, noFiles, caseFilePath.toString(), resultsDir, "cfg");

        assertThat(summary.threshold()).isEqualTo(55.0);
    }

    @Test
    void run_withLoadedNetwork_writesContingencyCsv() throws Exception {
        var net = IeeeFileAdapter.createAclfNet(caseFilePath.toString());

        ContingencyRunner.run(paths, cliArgs, net, resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
    }

    @Test
    void run_withoutContAndMonitorFiles_writesContingencyCsv() throws Exception {
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.run(paths, noFiles, caseFilePath.toString(), resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
    }

    @Test
    void validateInputs_allowsMissingContAndMonitorArgs() {
        CliArgs missingFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.validateInputs(paths, missingFiles);

        assertThat(inputs.contPath()).isNull();
        assertThat(inputs.monitorPath()).isNull();
    }

    @Test
    void validateInputs_rejectsMissingContingencyFile() {
        CliArgs cli = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                "missing/cont.json", AgentTestSupport.IEEE14_MONITOR);

        assertThatThrownBy(() -> ContingencyRunner.validateInputs(paths, cli))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Contingency file not found");
    }

    @Test
    void validateInputs_rejectsMissingMonitorFile() {
        CliArgs cli = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                AgentTestSupport.IEEE14_CONT, "missing/monitor.json");

        assertThatThrownBy(() -> ContingencyRunner.validateInputs(paths, cli))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Monitor file not found");
    }

    @Test
    void resolveInputs_usesCaseCaRunConfig() throws Exception {
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.resolveInputs(paths, noFiles);

        assertThat(inputs.contPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_CONT));
        assertThat(inputs.monitorPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_MONITOR));
    }

    @Test
    void resolveInputs_explicitArgsOverrideConfig() throws Exception {
        // The config names the monitored-branches file only; the CLI supplies the contingency file.
        writeCaRunConfig(null, AgentTestSupport.IEEE14_MONITOR);
        CliArgs cli = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT,
                AgentTestSupport.IEEE14_CONT, null);

        ContingencyRunner.ValidatedContingencyInputs inputs = ContingencyRunner.resolveInputs(paths, cli);

        assertThat(inputs.contPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_CONT));
        assertThat(inputs.monitorPath()).isEqualTo(paths.resolveWspace(AgentTestSupport.IEEE14_MONITOR));
    }

    @Test
    void resolveInputs_fallsBackToDefaultsWithoutConfig() {
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.resolveInputs(paths, noFiles);

        assertThat(inputs.contPath()).isNull();
        assertThat(inputs.monitorPath()).isNull();
    }

    @Test
    void resolveInputs_ignoresFilesWhenModeIsAll() throws Exception {
        // A named file with mode "all" is inert: the mode decides, not the key.
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR, "all", "all");
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ValidatedContingencyInputs inputs =
                ContingencyRunner.resolveInputs(paths, noFiles);

        assertThat(inputs.contPath()).isNull();
        assertThat(inputs.monitorPath()).isNull();
    }

    @Test
    void resolveInputs_rejectsMissingFileFromConfig() throws Exception {
        writeCaRunConfig("data/ieee/Ieee14Bus/missing_contingencies.json", AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("contingencyFile not found");
    }

    @Test
    void resolveInputs_rejectsCustomModeWithoutFile() throws Exception {
        // Mode custom with a null file key: the helper's 2-arg form cannot
        // express this, so write both modes explicitly.
        writeCaRunConfig(null, AgentTestSupport.IEEE14_MONITOR, "custom", "custom");
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("names no contingencyFile");
    }

    @Test
    void resolveInputs_rejectsPathTraversal() throws Exception {
        writeCaRunConfig("../../etc/passwd", AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must be a path under wspace/");
    }

    @Test
    void resolveInputs_rejectsUnsupportedMode() throws Exception {
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR, "n1", "custom");
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        assertThatThrownBy(() -> ContingencyRunner.resolveInputs(paths, noFiles))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unsupported contingencyMode");
    }

    @Test
    void run_withCaseCaRunConfig_writesContingencyCsv() throws Exception {
        writeCaRunConfig(AgentTestSupport.IEEE14_CONT, AgentTestSupport.IEEE14_MONITOR);
        CliArgs noFiles = new CliArgs("ca", "ieee", AgentTestSupport.IEEE14_INPUT, null, null);

        ContingencyRunner.ContAnalysisSummary summary =
                ContingencyRunner.run(paths, noFiles, caseFilePath.toString(), resultsDir, stem);

        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists().content().isNotEmpty();
        // 1 contingency / 3 monitored branches in the ieee14 fixtures.
        assertThat(summary.numCont()).isEqualTo(1);
        assertThat(summary.numMonitored()).isEqualTo(3);
    }

    /**
     * The CA dialog's solver knobs reach the solver. The mapping is asserted field by field
     * against {@code DclfContingencyConfig}'s own getters, because a knob the dialog writes
     * and the runner forgets to copy is invisible in the CSV.
     */
    @Test
    void dclfConfig_copiesEveryKnobOntoTheSolverConfig() {
        CaRunConfig config = CaRunConfig.fromJson("{\"overloadThreshold\":75,\"dclfInclLoss\":false,"
                + "\"dclfScreening\":true,\"dcLoadingCutoff\":0,\"dcFlowChangeCutoff\":250,"
                + "\"solutionMethod\":\"WoodburyMatrixUpdate\",\"kluEndpointRhsBatchSize\":8,"
                + "\"cacheViolationCombinedShiftFactors\":true,\"islandingTreatment\":\"SKIP\","
                + "\"n1IslandingReplayEnabled\":true,\"multiOutageReplayMode\":\"HIGH_IMPEDANCE\","
                + "\"highImpedanceReactancePu\":1234.5,\"turnOffIslandBus\":false,"
                + "\"autoTurnLine2Xfr\":false,\"ratingProvider\":\"RATING_A\"}", "test");

        DclfContingencyConfig dclf = ContingencyRunner.dclfConfig(config);

        assertThat(dclf.getOverloadThreshold()).isEqualTo(75.0);
        assertThat(dclf.isDclfInclLoss()).isFalse();
        assertThat(dclf.isDclfScreening()).isTrue();
        assertThat(dclf.getDcLoadingCutoff()).isZero();
        assertThat(dclf.getDcFlowChangeCutoff()).isEqualTo(250.0);
        assertThat(dclf.getSolutionMethod()).isEqualTo(DclfContingencySolutionMethod.WoodburyMatrixUpdate);
        assertThat(dclf.getKluEndpointRhsBatchSize()).isEqualTo(8);
        assertThat(dclf.isCacheViolationCombinedShiftFactors()).isTrue();
        assertThat(dclf.getIslandingTreatment()).isEqualTo(DclfIslandingTreatment.SKIP);
        assertThat(dclf.isN1IslandingReplayEnabled()).isTrue();
        assertThat(dclf.getMultiOutageReplayMode()).isEqualTo(DclfMultiOutageReplayMode.HIGH_IMPEDANCE);
        assertThat(dclf.getHighImpedanceReactancePu()).isEqualTo(1234.5);
        assertThat(dclf.isTurnOffIslandBus()).isFalse();
        assertThat(dclf.isAutoTurnLine2Xfr()).isFalse();
        assertThat(dclf.getBranchRatingProvider()).isSameAs(BranchRatingProvider.RATING_A);
    }

    /**
     * `default` is the library's own provider. Measured on ipss.core.lib 1.4.0 that provider
     * *is* {@code RATING_B} (the branch's rating MVA 2 — 690 MVA on the IEEE 39 case, where
     * RATING_A's 600 MVA reports five more overloads), so `default` never picks RATING_A.
     */
    @Test
    void dclfConfig_keepsTheLibraryProviderForTheDefaultRatingChoice() {
        DclfContingencyConfig dclf = ContingencyRunner.dclfConfig(CaRunConfig.DEFAULT);

        assertThat(dclf.getBranchRatingProvider()).isNotSameAs(BranchRatingProvider.RATING_A);
        assertThat(dclf.getBranchRatingProvider()).isSameAs(BranchRatingProvider.RATING_B);
        assertThat(dclf.getOverloadThreshold()).isEqualTo(90.0);
        assertThat(dclf.isDclfInclLoss()).isTrue();
    }

    /** Write the case {@code config/ca_run.json}; a null file key leaves the mode at {@code all}. */
    private void writeCaRunConfig(String contingencyFile, String monitoredBranchFile) throws Exception {
        writeCaRunConfig(contingencyFile, monitoredBranchFile,
                contingencyFile == null ? "all" : "custom",
                monitoredBranchFile == null ? "all" : "custom");
    }

    private void writeCaRunConfig(String contingencyFile, String monitoredBranchFile,
            String contingencyMode, String monitorMode) throws Exception {
        Path config = paths.caseCaRunConfig(AgentTestSupport.IEEE14_INPUT);
        Files.createDirectories(config.getParent());
        StringBuilder json = new StringBuilder("{\n");
        json.append("  \"contingencyMode\": \"").append(contingencyMode).append("\",\n");
        json.append("  \"contingencyFile\": ").append(quote(contingencyFile)).append(",\n");
        json.append("  \"monitorMode\": \"").append(monitorMode).append("\",\n");
        json.append("  \"monitoredBranchFile\": ").append(quote(monitoredBranchFile)).append("\n}\n");
        Files.writeString(config, json.toString());
    }

    private static String quote(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }
}
