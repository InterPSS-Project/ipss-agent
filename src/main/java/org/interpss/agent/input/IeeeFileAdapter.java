package org.interpss.agent.input;

import org.interpss.fadapter.ieeecdf.IeeeCDFDirectParser;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Creates an {@link AclfNetwork} from an IEEE Common Format (CDF) file.
 */
public final class IeeeFileAdapter {

    private IeeeFileAdapter() {
    }

    public static AclfNetwork createAclfNet(String filePath) throws Exception {
        return new IeeeCDFDirectParser().parse(filePath);
    }
}
