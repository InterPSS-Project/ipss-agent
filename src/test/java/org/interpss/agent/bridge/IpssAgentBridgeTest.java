package org.interpss.agent.bridge;

import static org.assertj.core.api.Assertions.assertThat;

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
}
