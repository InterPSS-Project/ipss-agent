package org.interpss.agent.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.plugin.aclf.config.AclfRunConfigRec;
import org.junit.jupiter.api.Test;

import com.interpss.core.LoadflowAlgoObjectFactory;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.LoadflowAlgorithm;

class IpssNetworkInfoTest {

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
