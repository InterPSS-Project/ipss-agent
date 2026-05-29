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
import com.interpss.core.algo.LoadflowAlgorithm;

/**
 * Runs AC load flow and writes CSV / network-info results.
 */
public final class AclfRunner {

    private AclfRunner() {
    }

    public static void run(ProjectPaths paths, String format, String caseFilePath,
            String inputRelative, Path resultsDir, String stem) throws Exception {
        AclfNetwork net = NetworkLoader.loadNetwork(format, caseFilePath);
        run(paths, inputRelative, net, resultsDir, stem);
    }

    public static void run(ProjectPaths paths, String inputRelative, AclfNetwork net,
            Path resultsDir, String stem) throws Exception {
        LoadflowAlgorithm algo = LoadflowAlgoObjectFactory.createLoadflowAlgorithm(net);

        Path configPath = paths.resolveAclfRunConfig(inputRelative);
        System.out.println("Using config file: " + configPath);
        AclfRunConfigRec aclfRunConfig = AclfRunConfigRec.loadAclfRunConfig(configPath.toString());
        aclfRunConfig.configAclfRun(
                algo,
                aclfRunConfig.polarCoordinate,
                aclfRunConfig.includeAdjustments,
                false);

        algo.loadflow();

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
}
