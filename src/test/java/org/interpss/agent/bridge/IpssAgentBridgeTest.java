package org.interpss.agent.bridge;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.support.AgentTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

class IpssAgentBridgeTest {

    @TempDir
    Path tempDir;

    private IpssAgentBridge bridge;
    private String casePath;
    private String configPath;
    private Path resultsDir;
    private String stem;

    @BeforeEach
    void setUp() throws Exception {
        bridge = new IpssAgentBridge();
        casePath = AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString();
        configPath = AgentTestSupport.resourcePath(AgentTestSupport.IEEE14_ACLF_CONFIG).toString();
        resultsDir = tempDir.resolve("results");
        stem = "ieee14";
    }

    @Test
    void loadCase_returnsSuccessJson() {
        String json = bridge.loadCase("ieee", casePath);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("format").getAsString()).isEqualTo("ieee");
        assertThat(o.get("busCount").getAsInt()).isEqualTo(14);
        assertThat(o.get("branchCount").getAsInt()).isPositive();
    }

    @Test
    void loadCase_returnsErrorForMissingFile() {
        String json = bridge.loadCase("ieee", tempDir.resolve("missing.ieee").toString());
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isFalse();
        assertThat(o.get("error").getAsString()).isNotBlank();
    }

    @Test
    void runAclf_writesResultsAndReturnsConvergedStatus() throws Exception {
        String json = bridge.runAclf("ieee", casePath, configPath, resultsDir.toString(), stem);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("converged").getAsBoolean()).isTrue();
        assertThat(o.get("networkInfo").getAsString()).contains("Loadflow converged: true");
        assertThat(resultsDir.resolve(stem + "_DF_bus.csv")).exists();
    }

    @Test
    void runAclf_reusesCachedNetworkForSamePath() throws Exception {
        bridge.loadCase("ieee", casePath);

        String json = bridge.runAclf("ieee", casePath, configPath, resultsDir.toString(), stem);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("converged").getAsBoolean()).isTrue();
    }

    /**
     * A case folder with a {@code scripts/} directory, as the Host resolves scripts —
     * the bridge refuses any script outside it.
     */
    private Path caseWithScripts(String scriptName, String code) throws Exception {
        Path caseDir = Files.createDirectories(tempDir.resolve("case-" + scriptName.replace('.', '_')));
        Path caseFile = caseDir.resolve("ieee14.ieee");
        Files.copy(AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE), caseFile);
        Path scripts = Files.createDirectories(caseDir.resolve("scripts"));
        Files.writeString(scripts.resolve(scriptName), code);
        return caseDir;
    }

    @Test
    void runGvy_appliesAScriptFromTheCaseScriptsDir() throws Exception {
        Path caseDir = caseWithScripts("adj.gvy", """
                bus = aclfnet.getBus('Bus14');
                load = bus.getContributeLoad('Bus14-L1');
                load.loadCP = new Complex(0.18, 0.07);
                """);
        String casePath = caseDir.resolve("ieee14.ieee").toString();
        String scriptPath = caseDir.resolve("scripts/adj.gvy").toString();

        String json = bridge.runGvy("ieee", casePath, scriptPath, false);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("script").getAsString()).endsWith("adj.gvy");
        assertThat(o.get("buses").getAsInt()).isEqualTo(14);
        assertThat(o.get("loadMw").getAsDouble() - o.get("loadMwBefore").getAsDouble()).isCloseTo(3.1,
                org.assertj.core.data.Offset.offset(0.05));

        // The edit is visible to the other tools on the same held model.
        JsonObject info = JsonParser.parseString(bridge.summarize("net", null, 1)).getAsJsonObject();
        assertThat(info.get("ok").getAsBoolean()).isTrue();
    }

    @Test
    void runGvySource_evaluatesInlineCodeWithoutAFile() throws Exception {
        Path caseDir = caseWithScripts("unused.gvy", "aclfnet.id = 'unused'\n");
        String casePath = caseDir.resolve("ieee14.ieee").toString();

        String json = bridge.runGvySource("ieee", casePath, """
                bus = aclfnet.getBus('Bus14');
                load = bus.getContributeLoad('Bus14-L1');
                load.loadCP = new Complex(0.50, 0.30);
                """, false);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("script").getAsString()).isEqualTo("inline Groovy (4 lines)");
        assertThat(o.get("buses").getAsInt()).isEqualTo(14);
        assertThat(o.get("loadMw").getAsDouble() - o.get("loadMwBefore").getAsDouble()).isCloseTo(35.1,
                org.assertj.core.data.Offset.offset(0.05));

        // The inline edit lands on the same held model the other tools read.
        JsonObject info = JsonParser.parseString(bridge.summarize("net", null, 1)).getAsJsonObject();
        assertThat(info.get("ok").getAsBoolean()).isTrue();
    }

    @Test
    void runGvySource_reportsAScriptFailureWithItsLineAndRejectsEmptySource() throws Exception {
        Path caseDir = caseWithScripts("unused.gvy", "aclfnet.id = 'unused'\n");
        String casePath = caseDir.resolve("ieee14.ieee").toString();

        JsonObject broken = JsonParser.parseString(
                bridge.runGvySource("ieee", casePath, "aclfnet.noSuchThing = 1\n", false)).getAsJsonObject();
        assertThat(broken.get("ok").getAsBoolean()).isFalse();
        assertThat(broken.get("error").getAsString()).contains("noSuchThing");
        assertThat(broken.get("line").getAsInt()).isEqualTo(1);

        JsonObject empty = JsonParser.parseString(bridge.runGvySource("ieee", casePath, "  \n", false)).getAsJsonObject();
        assertThat(empty.get("ok").getAsBoolean()).isFalse();
        assertThat(empty.get("error").getAsString()).contains("empty");
    }

    @Test
    void inlineLabel_countsTheScriptLines() {
        assertThat(IpssAgentBridge.inlineLabel("x = 1")).isEqualTo("inline Groovy (1 line)");
        assertThat(IpssAgentBridge.inlineLabel("a\nb\nc")).isEqualTo("inline Groovy (3 lines)");
        assertThat(IpssAgentBridge.inlineLabel("a\n")).isEqualTo("inline Groovy (2 lines)");
        assertThat(IpssAgentBridge.inlineLabel("   ")).isEqualTo("inline Groovy");
        assertThat(IpssAgentBridge.inlineLabel(null)).isEqualTo("inline Groovy");
    }

    @Test
    void runGvy_rejectsAScriptOutsideTheScriptsDir() throws Exception {
        Path caseDir = caseWithScripts("adj.gvy", "aclfnet.id = 'x'\n");
        Path stray = Files.writeString(tempDir.resolve("stray.gvy"), "aclfnet.id = 'y'\n");

        String json = bridge.runGvy("ieee", caseDir.resolve("ieee14.ieee").toString(), stray.toString(), false);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isFalse();
        assertThat(o.get("error").getAsString()).contains("must live in");
    }

    @Test
    void runGvy_rejectsANonGvyFile() throws Exception {
        Path caseDir = caseWithScripts("adj.gvy", "aclfnet.id = 'x'\n");
        Path plain = Files.writeString(caseDir.resolve("scripts/readme.txt"), "not a script");

        String json = bridge.runGvy("ieee", caseDir.resolve("ieee14.ieee").toString(), plain.toString(), false);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isFalse();
        assertThat(o.get("error").getAsString()).contains(".gvy");
    }

    @Test
    void runGvy_reportsAScriptFailureWithItsLine() throws Exception {
        Path caseDir = caseWithScripts("broken.gvy", """
                bus = aclfnet.getBus('Bus14');
                bus.noSuchProperty = 1;
                """);

        String json = bridge.runGvy("ieee", caseDir.resolve("ieee14.ieee").toString(),
                caseDir.resolve("scripts/broken.gvy").toString(), false);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isFalse();
        assertThat(o.get("error").getAsString()).as(json).contains("noSuchProperty");
        assertThat(o.get("line").getAsInt()).isGreaterThan(0);
    }

    @Test
    void runGvy_reusesTheHeldModelUnlessReloadIsRequested() throws Exception {
        Path caseDir = caseWithScripts("bump.gvy", """
                load = aclfnet.getBus('Bus14').getContributeLoad('Bus14-L1');
                cp = load.loadCP;
                load.loadCP = new Complex(cp.real + 0.1, cp.imaginary);
                """);
        String casePath = caseDir.resolve("ieee14.ieee").toString();
        String scriptPath = caseDir.resolve("scripts/bump.gvy").toString();

        // IEEE 14 totals 259 MW; Bus14 holds 14.9 MW, so +0.1 pu is +10 MW.
        JsonObject first = JsonParser.parseString(bridge.runGvy("ieee", casePath, scriptPath, false))
                .getAsJsonObject();
        assertThat(first.get("loadMwBefore").getAsDouble()).isCloseTo(259.0, org.assertj.core.data.Offset.offset(1.0));
        assertThat(first.get("loadMw").getAsDouble()).as(first.toString()).isCloseTo(269.0, org.assertj.core.data.Offset.offset(1.0));

        // Without reload the held model keeps the edit, so the bump compounds.
        JsonObject again = JsonParser.parseString(bridge.runGvy("ieee", casePath, scriptPath, false))
                .getAsJsonObject();
        assertThat(again.get("loadMwBefore").getAsDouble()).isCloseTo(269.0, org.assertj.core.data.Offset.offset(1.0));
        assertThat(again.get("loadMw").getAsDouble()).isCloseTo(279.0, org.assertj.core.data.Offset.offset(1.0));

        // reload re-parses the case, so the mutation starts from the file's own value.
        JsonObject fresh = JsonParser.parseString(bridge.runGvy("ieee", casePath, scriptPath, true))
                .getAsJsonObject();
        assertThat(fresh.get("loadMwBefore").getAsDouble()).isCloseTo(259.0, org.assertj.core.data.Offset.offset(1.0));
        assertThat(fresh.get("loadMw").getAsDouble()).isCloseTo(269.0, org.assertj.core.data.Offset.offset(1.0));
    }

    @Test
    void summarize_returnsErrorWhenNoNetworkLoaded() {
        String json = bridge.summarize("net", null, 5);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isFalse();
        assertThat(o.get("error").getAsString()).contains("no loaded network");
    }
    @Test
    void summarize_supportsAllScopes() throws Exception {
        bridge.loadCase("ieee", casePath);
        bridge.runAclf("ieee", casePath, configPath, resultsDir.toString(), stem);

        for (String scope : new String[] {"net", "bus", "branch", "gen", "load"}) {
            String json = bridge.summarize(scope, "Lowest Bus Voltage", 3);
            JsonObject o = JsonParser.parseString(json).getAsJsonObject();
            assertThat(o.get("ok").getAsBoolean()).isTrue();
            assertThat(o.get("scope").getAsString()).isEqualTo(scope);
            assertThat(o.get("text").getAsString()).isNotBlank();
        }
    }

    @Test
    void summarize_usesHighVoltageComparatorWhenRequested() throws Exception {
        bridge.runAclf("ieee", casePath, configPath, resultsDir.toString(), stem);

        String json = bridge.summarize("bus", "Highest Bus Voltage", 3);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("text").getAsString()).isNotBlank();
    }

    @Test
    void runContingency_withoutContAndMonitorFiles_writesCsv() throws Exception {
        bridge.loadCase("ieee", casePath);

        String json = bridge.runContingency(
                "ieee", casePath, null, null, resultsDir.toString(), stem);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("contingencyFile").getAsString()).isEqualTo(stem + "_DF_contingency.csv");
        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists();
    }

    @Test
    void runContingency_blankContAndMonitorPaths_useDefaults() throws Exception {
        String json = bridge.runContingency(
                "ieee", casePath, "", "  ", resultsDir.toString(), stem);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();

        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(resultsDir.resolve(stem + "_DF_contingency.csv")).exists();
    }

    @Test
    void getNetworkInfo_returnsEmptyBeforeLoad() {
        assertThat(bridge.getNetworkInfo()).isEmpty();
    }

    @Test
    void getNetworkInfo_returnsFormattedTextAfterLoad() {
        bridge.loadCase("ieee", casePath);

        assertThat(bridge.getNetworkInfo()).contains("Number of Active Buses:");
    }

    @Test
    void clear_resetsCachedNetwork() throws Exception {
        bridge.loadCase("ieee", casePath);
        assertThat(bridge.getNetworkInfo()).isNotEmpty();

        bridge.clear();

        assertThat(bridge.getNetworkInfo()).isEmpty();
        String json = bridge.summarize("net", null, 5);
        assertThat(JsonParser.parseString(json).getAsJsonObject().get("ok").getAsBoolean()).isFalse();
    }

    @Test
    @org.junit.jupiter.api.condition.EnabledIf("org.interpss.agent.ReportCliTest#ieee14ResultExists")
    void runReport_returnsMarkdownForIeee14() throws Exception {
        org.interpss.agent.util.ProjectPaths paths = org.interpss.agent.util.ProjectPaths.discover();
        String json = bridge.runReport(
                "nerc", "IEEE 14-Bus System", paths.projectRoot().toString(), "data/ieee/Ieee14Bus/result", null);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();
        assertThat(o.get("ok").getAsBoolean()).isTrue();
        assertThat(o.get("markdown").getAsString())
                .contains("NERC TPL-001-5 Transmission System Planning Performance");
        assertThat(o.get("reportFile").getAsString()).isEqualTo("NERC_TPL_001_5_Report.md");
        assertThat(paths.resolveWspace("data/ieee/Ieee14Bus/result/NERC_TPL_001_5_Report.md")).exists();
    }
}
