package org.interpss.agent.input;

import static org.assertj.core.api.Assertions.assertThat;

import org.interpss.agent.support.AgentTestSupport;
import org.junit.jupiter.api.Test;

import com.interpss.core.aclf.AclfNetwork;

class BpaFileAdapterTest {

    @Test
    void createAclfNet_loadsBpaIeee9Case() throws Exception {
        AclfNetwork net = BpaFileAdapter.createAclfNet(
                AgentTestSupport.absoluteResourcePath(AgentTestSupport.BPA9_CASE).toString());

        assertThat(net.getNoActiveBus()).isEqualTo(9);
        assertThat(net.getNoActiveBranch()).isPositive();
    }
}
