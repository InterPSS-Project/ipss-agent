package org.interpss.agent.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AnalyzerTest {

    private ReportConfig cfg;

    @BeforeEach
    void setUp() throws Exception {
        cfg = ReportConfig.load(Path.of(".").toAbsolutePath().normalize());
    }

    @Test
    void voltageAnalyzer_flagsLowViolation() {
        List<Map<String, String>> buses = List.of(
                Map.of("Number", "1", "Name", "Bus1", "VoltMag", "0.94", "InService", "true"));
        VoltageAnalyzer.VoltageProfileResult result = VoltageAnalyzer.analyze(buses, cfg);
        assertThat(result.passed()).isFalse();
        assertThat(result.violationsLow()).hasSize(1);
    }

    @Test
    void voltageAnalyzer_excludesOutOfServiceBuses() {
        List<Map<String, String>> buses = List.of(
                Map.of("Number", "1", "Name", "Bus1", "VoltMag", "0.0", "InService", "false"),
                Map.of("Number", "2", "Name", "Bus2", "VoltMag", "1.0", "InService", "true"));
        VoltageAnalyzer.VoltageProfileResult result = VoltageAnalyzer.analyze(buses, cfg);
        assertThat(result.inactiveExcluded()).isEqualTo(1);
        assertThat(result.busesAnalyzed()).isEqualTo(1);
        assertThat(result.passed()).isTrue();
    }

    @Test
    void branchLoadingAnalyzer_usesLoadingPercentWhenPresent() {
        Map<String, String> branch = new java.util.LinkedHashMap<>();
        branch.put("Name", "Line1");
        branch.put("ID", "L1");
        branch.put("FromBusName", "A");
        branch.put("ToBusName", "B");
        branch.put("Circuit", "1");
        branch.put("PFrom2To", "0.5");
        branch.put("QFrom2To", "0.0");
        branch.put("LimMvaA", "1.0");
        branch.put("LimMvaB", "0");
        branch.put("LimMvaC", "0");
        branch.put("Loading%", "110");
        branch.put("IsXfmr", "false");
        BranchLoadingAnalyzer.BranchLoadingResult result =
                BranchLoadingAnalyzer.analyze(List.of(branch), cfg);
        assertThat(result.overloaded()).hasSize(1);
        assertThat(result.overloaded().get(0).loadingPct()).isEqualTo(110.0);
    }

    @Test
    void generatorQAnalyzer_detectsViolation() {
        List<Map<String, String>> gens = List.of(Map.of(
                "BusNumber", "1",
                "BusName", "Gen1",
                "PGen", "1.0",
                "QGen", "0.5",
                "QMax", "0.4",
                "QMin", "-0.4"));
        GeneratorQAnalyzer.GeneratorQResult result = GeneratorQAnalyzer.analyze(gens, cfg);
        assertThat(result.violations()).hasSize(1);
    }

    @Test
    void contingencyAnalyzer_deduplicatesOverloads() {
        List<Map<String, String>> rows = List.of(
                Map.of(
                        "BranchID", "BR1",
                        "ContingencyName", "C1",
                        "OutageBranchName", "OUT1",
                        "BasecaseFlowMW", "100",
                        "PostFlowMW", "120",
                        "LineRatingMW", "100",
                        "LoadingPercent", "120"),
                Map.of(
                        "BranchID", "BR1",
                        "ContingencyName", "C1",
                        "OutageBranchName", "OUT1",
                        "BasecaseFlowMW", "100",
                        "PostFlowMW", "120",
                        "LineRatingMW", "100",
                        "LoadingPercent", "120"));
        ContingencyAnalyzer.ContingencyResults result = ContingencyAnalyzer.analyzeResults(rows, cfg);
        assertThat(result.totalOverloads()).isEqualTo(1);
        assertThat(result.p1ThermalPass()).isFalse();
    }
}
