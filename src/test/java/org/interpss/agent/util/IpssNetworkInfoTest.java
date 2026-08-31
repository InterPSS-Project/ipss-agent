package org.interpss.agent.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.input.PsseFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.plugin.aclf.config.AclfRunConfigRec;
import org.junit.jupiter.api.Test;

import com.interpss.core.LoadflowAlgoObjectFactory;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.LoadflowAlgorithm;

class IpssNetworkInfoTest {

    @Test
    void format_containsNetworkAndLoadflowSummary_Texas2K() throws Exception {
        String casePath = AgentTestSupport.projectRootPath(AgentTestSupport.TEXAS2K_CASE).toString();
        String configPath = AgentTestSupport.projectRootPath(AgentTestSupport.DEFAULT_ACLF_CONFIG).toString();

        AclfNetwork net = PsseFileAdapter.createAclfNet(casePath);
        LoadflowAlgorithm algo = LoadflowAlgoObjectFactory.createLoadflowAlgorithm(net);
        AclfRunConfigRec config = AclfRunConfigRec.loadAclfRunConfig(configPath);
        config.configAclfRun(algo, config.polarCoordinate, config.includeAdjustments, false);
        algo.loadflow();

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
        assertThat(info).contains("Bus1050");
        assertThat(info).doesNotContain("dQmax :  2.26025");
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
