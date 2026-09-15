package org.interpss.agent.util;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;

import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.input.PsseFileAdapter;
import org.interpss.agent.runner.AclfRunner;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.plugin.aclf.config.AclfRunConfigRec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.interpss.core.LoadflowAlgoObjectFactory;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.AclfMethodType;
import com.interpss.core.algo.LoadflowAlgorithm;

class IpssNetworkInfoTest {

    /**
     * Texas 2K is the case where InterPSS returns from {@code algo.loadflow()} with its
     * last switched-shunt step applied but not re-solved: Bus2127 (MIAMI 0, a PV bus
     * converted to PQ next to a 200 Mvar shunt) then sits 2.26 pu out of balance. The
     * runner settles that before writing, so the reported mismatch is the residual of the
     * state the CSVs describe — and the two used to disagree by exactly that 226 Mvar.
     */
    @Test
    void format_reportsTheSettledResidual_Texas2K(@TempDir Path resultsDir) throws Exception {
        String casePath = AgentTestSupport.projectRootPath(AgentTestSupport.TEXAS2K_CASE).toString();
        String configPath = AgentTestSupport.projectRootPath(AgentTestSupport.DEFAULT_ACLF_CONFIG).toString();

        AclfNetwork net = PsseFileAdapter.createAclfNet(casePath);
        AclfRunner.runOnNet(net, configPath, resultsDir, "texas2k");

        String info = IpssNetworkInfo.format(net);
        System.out.println(info);

        assertThat(info).contains("=====Aclf Network Information:=====");
        assertThat(info).contains("Number of Active Buses: 2000");
        assertThat(info).contains("Number of Active Branches: 3220");
        assertThat(info).contains("Total Generation (MW):");
        assertThat(info).contains("Total Load (MW):");
        assertThat(info).contains("PV bus limit controls: 373");
        assertThat(info).contains("Switched shunts: 153");
        assertThat(info).contains("===== Loadflow Run Information:=====");
        assertThat(info).contains("Loadflow converged: true");
        assertThat(info).contains("Max Mismatch:");
        assertThat(info).doesNotContain("2.2602");
        assertThat(net.getBus("Bus2127").mismatch(AclfMethodType.NR).abs())
                .as("Bus2127 balanced after the settle pass")
                .isLessThan(1.0e-4);
    }

    @Test
    void format_containsNetworkAndLoadflowSummary() throws Exception {
        String casePath = AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString();
        String configPath = AgentTestSupport.resourcePath(AgentTestSupport.IEEE14_ACLF_CONFIG).toString();

        AclfNetwork net = IeeeFileAdapter.createAclfNet(casePath);
        LoadflowAlgorithm algo = LoadflowAlgoObjectFactory.createLoadflowAlgorithm(net);
        AclfRunConfigRec config = AclfRunConfigRec.loadAclfRunConfig(configPath);
        config.configAclfRun(algo, config.polarCoordinate, config.includeAdjustments, false);
        algo.loadflow();

        String info = IpssNetworkInfo.format(net);

        assertThat(info).contains("=====Aclf Network Information:=====");
        assertThat(info).contains("Number of Active Buses:");
        assertThat(info).contains("Number of Active Branches:");
        assertThat(info).contains("Total Generation (MW):");
        assertThat(info).contains("Total Load (MW):");
        assertThat(info).contains("===== Loadflow Run Information:=====");
        assertThat(info).contains("Loadflow converged: true");
    }
}
