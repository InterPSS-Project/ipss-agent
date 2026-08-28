package org.interpss.agent.input;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.interpss.agent.support.AgentTestSupport;
import org.junit.jupiter.api.Test;

import com.interpss.core.aclf.AclfNetwork;

class NetworkLoaderTest {

    @Test
    void loadNetwork_dispatchesToIeeeAdapter() throws Exception {
        AclfNetwork net = NetworkLoader.loadNetwork(
                "ieee",
                AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());

        assertThat(net.getNoActiveBus()).isEqualTo(14);
    }

    @Test
    void loadNetwork_dispatchesToPsseAdapter() throws Exception {
        AclfNetwork net = NetworkLoader.loadNetwork(
                "psse",
                AgentTestSupport.absoluteResourcePath(AgentTestSupport.PSSE9_CASE).toString());

        assertThat(net.getNoActiveBus()).isEqualTo(9);
    }

    @Test
    void loadNetwork_rejectsInvalidFormat() {
        assertThatThrownBy(() -> NetworkLoader.loadNetwork("matpower", "case.ieee"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid format");
    }
}
