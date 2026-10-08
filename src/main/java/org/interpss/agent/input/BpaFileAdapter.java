package org.interpss.agent.input;

import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.BPA;

import org.interpss.plugin.pssl.plugin.IpssAdapter;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Creates an {@link AclfNetwork} from a BPA IPF NETWORK_DATA (.dat) file.
 */
public final class BpaFileAdapter {

    private BpaFileAdapter() {
    }

    public static AclfNetwork createAclfNet(String filePath) throws Exception {
        return IpssAdapter.importAclfNet(filePath)
                .setFormat(BPA)
                .load()
                .getImportedObj();
    }
}
