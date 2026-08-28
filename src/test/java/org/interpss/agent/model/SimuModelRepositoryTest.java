package org.interpss.agent.model;

import static org.assertj.core.api.Assertions.assertThat;

import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.junit.jupiter.api.Test;

import com.interpss.core.aclf.AclfNetwork;

class SimuModelRepositoryTest {

    @Test
    void getAclfNetBase_initiallyNull() {
        SimuModelRepository repo = new SimuModelRepository();
        assertThat(repo.getAclfNetBase()).isNull();
    }

    @Test
    void setAclfNetBase_roundTripsLoadedNetwork() throws Exception {
        SimuModelRepository repo = new SimuModelRepository();
        AclfNetwork net = IeeeFileAdapter.createAclfNet(
                AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());

        repo.setAclfNetBase(net);

        assertThat(repo.getAclfNetBase()).isSameAs(net);
        assertThat(repo.getAclfNetBase().getNoActiveBus()).isEqualTo(net.getNoActiveBus());
    }
}
