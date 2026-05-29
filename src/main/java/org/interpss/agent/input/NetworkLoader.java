package org.interpss.agent.input;

import com.interpss.core.aclf.AclfNetwork;

import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.IEEECommonFormat;
import static org.interpss.plugin.pssl.plugin.IpssAdapter.FileFormat.PSSE;
import org.interpss.plugin.pssl.plugin.IpssAdapter;

/**
 * Loads an {@link AclfNetwork} from IEEE or PSS/E case files.
 */
public final class NetworkLoader {

    private NetworkLoader() {
    }

    public static AclfNetwork loadNetwork(String format, String filePath) throws Exception {
        return switch (format) {
            case "ieee" -> createIeeeAclfNet(filePath);
            case "psse" -> createPsseAclfNet(filePath);
            default -> {
                System.err.println("Invalid format");
                System.exit(1);
                throw new IllegalStateException();
            }
        };
    }

    private static AclfNetwork createIeeeAclfNet(String filePath) throws Exception {
        return IpssAdapter.importAclfNet(filePath)
                .setFormat(IEEECommonFormat)
            .load()
            .getImportedObj();
    }

    private static AclfNetwork createPsseAclfNet(String filePath) throws Exception {
        return IpssAdapter.importAclfNet(filePath)
                .setFormat(PSSE)
                .load()
                .getImportedObj();
    }
}
