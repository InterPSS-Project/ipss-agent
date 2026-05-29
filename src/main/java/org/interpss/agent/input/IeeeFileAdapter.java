package org.interpss.agent.input;

import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.IEEECommonFormat;

import org.interpss.plugin.pssl.plugin.IpssAdapter;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Creates an {@link AclfNetwork} from an IEEE Common Format (CDF) file.
 */
public final class IeeeFileAdapter {

    private IeeeFileAdapter() {
    }

    public static AclfNetwork createAclfNet(String filePath) throws Exception {
        return IpssAdapter.importAclfNet(filePath)
                .setFormat(IEEECommonFormat)
                .load()
                .getImportedObj();
    }
}
