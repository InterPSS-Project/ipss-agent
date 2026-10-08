package org.interpss.agent.input;

import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.BPA;

import org.interpss.plugin.pssl.plugin.IpssAdapter;

import com.interpss.core.CoreObjectFactory;
import com.interpss.core.aclf.AclfBus;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.net.Area;
import com.interpss.core.net.Zone;

/**
 * Creates an {@link AclfNetwork} from a BPA IPF NETWORK_DATA (.dat) file.
 */
public final class BpaFileAdapter {

    private BpaFileAdapter() {
    }

    public static AclfNetwork createAclfNet(String filePath) throws Exception {
        AclfNetwork net = IpssAdapter.importAclfNet(filePath)
                .setFormat(BPA)
                .load()
                .getImportedObj();
        ensureAreaAndZone(net);
        return net;
    }

    /**
     * BPA cards often omit area; gen/load result adapters require non-null area/zone.
     */
    private static void ensureAreaAndZone(AclfNetwork net) {
        Area defaultArea = CoreObjectFactory.createArea(1L, net);
        if (defaultArea.getName() == null || defaultArea.getName().isBlank()) {
            defaultArea.setName("Area 1");
        }
        Zone defaultZone = CoreObjectFactory.createZone(1L, net);
        if (defaultZone.getName() == null || defaultZone.getName().isBlank()) {
            defaultZone.setName("Zone 1");
        }
        for (AclfBus bus : net.getBusList()) {
            if (bus.getArea() == null) {
                bus.setArea(defaultArea);
            }
            if (bus.getZone() == null) {
                bus.setZone(defaultZone);
            }
        }
    }
}
