package org.interpss.agent.input;

import static org.assertj.core.api.Assertions.assertThat;

import org.interpss.agent.support.AgentTestSupport;
import org.junit.jupiter.api.Test;

import com.interpss.core.aclf.AclfNetwork;

class PsseFileAdapterTest {

    @Test
    void createAclfNet_loadsIeee9Raw() throws Exception {
        AclfNetwork net = PsseFileAdapter.createAclfNet(
                AgentTestSupport.absoluteResourcePath(AgentTestSupport.PSSE9_CASE).toString());

        assertThat(net.getNoActiveBus()).isEqualTo(9);
        assertThat(net.getNoActiveBranch()).isPositive();
    }
}
