package org.interpss.agent.input;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.interpss.agent.support.AgentTestSupport;
import org.junit.jupiter.api.Test;

import com.interpss.core.aclf.AclfNetwork;

class IeeeFileAdapterTest {

    @Test
    void createAclfNet_loadsIeee14Case() throws Exception {
        AclfNetwork net = IeeeFileAdapter.createAclfNet(
                AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());

        assertThat(net.getNoActiveBus()).isEqualTo(14);
        assertThat(net.getNoActiveBranch()).isPositive();
    }
}
