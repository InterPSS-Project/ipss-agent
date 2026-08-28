package org.interpss.agent.input;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Loads an {@link AclfNetwork} from IEEE or PSS/E case files.
 */
public final class NetworkLoader {

    private NetworkLoader() {
    }

    public static AclfNetwork loadNetwork(String format, String filePath) throws Exception {
        return switch (format) {
            case "ieee" -> IeeeFileAdapter.createAclfNet(filePath);
            case "psse" -> PsseFileAdapter.createAclfNet(filePath);
            default -> throw new IllegalArgumentException("Invalid format: " + format);
        };
    }
}
