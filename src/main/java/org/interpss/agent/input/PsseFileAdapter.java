package org.interpss.agent.input;

import org.interpss.fadapter.psse.PSSEDirectParser;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Creates an {@link AclfNetwork} from a PSS/E RAW file.
 */
public final class PsseFileAdapter {

    private PsseFileAdapter() {
    }

    public static AclfNetwork createAclfNet(String filePath) throws Exception {
        return new PSSEDirectParser().parse(filePath);
    }
}
