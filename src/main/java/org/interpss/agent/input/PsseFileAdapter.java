package org.interpss.agent.input;

import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.PSSE;

import org.interpss.plugin.pssl.plugin.IpssAdapter;
import org.interpss.plugin.pssl.plugin.IpssAdapter.PsseVersion;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Creates an {@link AclfNetwork} from a PSS/E RAW file.
 */
public final class PsseFileAdapter {

    private PsseFileAdapter() {
    }

    public static AclfNetwork createAclfNet(String filePath) throws Exception {
        PsseVersion psseVersion = IpssAdapter.parsePsseVersion(filePath);
        return IpssAdapter.importAclfNet(filePath)
                .setFormat(PSSE)
                .setPsseVersion(psseVersion)
                .load()
                .getImportedObj();
    }
}
