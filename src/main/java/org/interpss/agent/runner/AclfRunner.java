package org.interpss.agent.runner;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.dflib.csv.Csv;
import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.util.IpssNetworkInfo;
import org.interpss.agent.util.ProjectPaths;
import org.interpss.plugin.aclf.config.AclfRunConfigRec;
import org.interpss.plugin.result.dframe.AclfNetDFrameAdapter;

import com.interpss.core.LoadflowAlgoObjectFactory;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.AclfMethodType;
import com.interpss.core.algo.LoadflowAlgorithm;
import com.interpss.core.datatype.Mismatch;

/**
 * Runs AC load flow and writes CSV / network-info results.
 */
public final class AclfRunner {

    /**
     * A post-solve mismatch above this (pu, 100 MVA base) means the last adjustment
     * was not carried into the solved state, so the run is solved again below.
     */
    private static final double SETTLE_TOLERANCE = 1.0e-4;

    /** Bound on the extra solves; two suffice in every case seen so far. */
    private static final int SETTLE_MAX_PASSES = 3;

    private AclfRunner() {
    }

    public static void run(ProjectPaths paths, String format, String caseFilePath,
            String inputRelative, Path resultsDir, String stem) throws Exception {
        AclfNetwork net = NetworkLoader.loadNetwork(format, caseFilePath);
        run(paths, inputRelative, net, resultsDir, stem);
    }

    public static void run(ProjectPaths paths, String inputRelative, AclfNetwork net,
            Path resultsDir, String stem) throws Exception {
        Path configPath = paths.resolveAclfRunConfig(inputRelative);
        runOnNet(net, configPath.toString(), resultsDir, stem);
    }

    /**
     * In-process core: run AC load flow on an already-loaded {@code net} using
     * an absolute {@code absoluteConfigPath}, then write the standard result
     * files. Shared by the CLI ({@code IpssCmd}) and the in-process bridge
     * ({@code IpssAgentBridge}).
     */
    public static void runOnNet(AclfNetwork net, String absoluteConfigPath,
            Path resultsDir, String stem) throws Exception {
        LoadflowAlgorithm algo = LoadflowAlgoObjectFactory.createLoadflowAlgorithm(net);

        System.out.println("Using config file: " + absoluteConfigPath);
        AclfRunConfigRec aclfRunConfig = AclfRunConfigRec.loadAclfRunConfig(absoluteConfigPath);
        aclfRunConfig.configAclfRun(
                algo,
                aclfRunConfig.polarCoordinate,
                aclfRunConfig.includeAdjustments,
                false);

        algo.loadflow();
        settle(net, algo);

        Files.writeString(
                resultsDir.resolve(stem + "_network_info.txt"),
                IpssNetworkInfo.format(net),
                StandardCharsets.UTF_8);

        AclfNetDFrameAdapter dfAdapter = new AclfNetDFrameAdapter();
        dfAdapter.adapt(net);

        Csv.saver().save(dfAdapter.getDfBus(), resultsDir.resolve(stem + "_DF_bus.csv").toString());
        Csv.saver().save(dfAdapter.getDfGen(), resultsDir.resolve(stem + "_DF_gen.csv").toString());
        Csv.saver().save(dfAdapter.getDfLoad(), resultsDir.resolve(stem + "_DF_load.csv").toString());
        Csv.saver().save(dfAdapter.getDfBranch(), resultsDir.resolve(stem + "_DF_branch.csv").toString());
    }

    /**
     * Re-solve while the state the load flow returned still violates the bus balance.
     *
     * <p>The NR loop can converge before its last adjustment — a switched-shunt step, a
     * PV→PQ limit conversion, a tap move — has been carried into the solved state, so the
     * returned voltages do not satisfy the model's own injections. On Texas 2K that left
     * Bus2127 (MIAMI 0, a PV bus converted to PQ with a 200 Mvar switched shunt) at
     * 2.26 pu dQ, i.e. a 226 Mvar violation behind a "converged" result; a second solve
     * settles it to 2.3e-7 pu and moves that bus from 1.0631 to 1.1196 pu.
     *
     * <p>Each pass is a full solve, so this runs only when the residual is significant,
     * stops as soon as it stops improving, and is bounded by {@link #SETTLE_MAX_PASSES}.
     */
    private static void settle(AclfNetwork net, LoadflowAlgorithm algo) throws Exception {
        double before = worstMismatch(net);
        for (int pass = 0; pass < SETTLE_MAX_PASSES && net.isLfConverged() && before > SETTLE_TOLERANCE; pass++) {
            algo.loadflow();
            double after = worstMismatch(net);
            if (!(after < before)) {
                return;
            }
            before = after;
        }
    }

    /** Largest |dP|/|dQ| residual over the network, in pu on the 100 MVA base. */
    private static double worstMismatch(AclfNetwork net) {
        Mismatch mismatch = net.maxMismatch(AclfMethodType.NR);
        if (mismatch == null || mismatch.maxMis == null) {
            return 0.0;
        }
        return Math.max(Math.abs(mismatch.maxMis.getReal()), Math.abs(mismatch.maxMis.getImaginary()));
    }
}
