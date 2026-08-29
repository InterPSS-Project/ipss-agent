package org.interpss.agent.bridge;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.model.SimuModelRepository;
import org.interpss.agent.report.ReportRunner;
import org.interpss.agent.report.ReportType;
import org.interpss.agent.runner.AclfRunner;
import org.interpss.agent.runner.ContingencyRunner;
import org.interpss.agent.util.IpssNetworkInfo;
import org.interpss.agent.util.ProjectPaths;
import org.interpss.plugin.result.AclfResultAdapter;
import org.interpss.plugin.result.AclfResultContainer;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.interpss.core.aclf.AclfNetwork;

/**
 * In-process facade for the Node (Cordis Host) bridge. All public methods are
 * {@code synchronized} so concurrent Host RPCs serialize on the single
 * base-case repository. Return values are JSON strings (or plain text for
 * {@link #getNetworkInfo()}) so the JS bridge stays simple; the JS side never
 * touches EMF/{@link AclfNetwork} objects.
 */
public final class IpssAgentBridge {

    private static final Gson GSON = new Gson();

    private final SimuModelRepository repo = new SimuModelRepository();
    private String loadedInput = null;

    /** Load ieee|psse into the base-case cache; does not run load flow. */
    public synchronized String loadCase(String format, String absoluteCasePath) {
        try {
            AclfNetwork net = NetworkLoader.loadNetwork(format, absoluteCasePath);
            repo.setAclfNetBase(net);
            loadedInput = absoluteCasePath;
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("format", format);
            o.addProperty("input", absoluteCasePath);
            o.addProperty("busCount", net.getNoActiveBus());
            o.addProperty("branchCount", net.getNoActiveBranch());
            return GSON.toJson(o);
        } catch (Exception e) {
            return error(e);
        }
    }

    /**
     * Run ACLF on the cached base case (reusing it when the path matches), or
     * load it first. Writes {@code *_network_info.txt} + {@code *_DF_*.csv}
     * under {@code absoluteResultsDir} using {@code absoluteConfigPath}.
     */
    public synchronized String runAclf(String format, String absoluteCasePath,
            String absoluteConfigPath, String absoluteResultsDir, String stem) {
        try {
            AclfNetwork net = repo.getAclfNetBase();
            if (net == null || loadedInput == null || !loadedInput.equals(absoluteCasePath)) {
                net = NetworkLoader.loadNetwork(format, absoluteCasePath);
                repo.setAclfNetBase(net);
                loadedInput = absoluteCasePath;
            }
            Path resultsDir = Paths.get(absoluteResultsDir);
            Files.createDirectories(resultsDir);
            AclfRunner.runOnNet(net, absoluteConfigPath, resultsDir, stem);
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("converged", net.isLfConverged());
            o.addProperty("networkInfo", IpssNetworkInfo.format(net));
            return GSON.toJson(o);
        } catch (Exception e) {
            return error(e);
        }
    }

    /**
     * Run DC contingency analysis on the cached base case (reusing it when the
     * path matches), or load it first. Writes {@code stem_DF_contingency.csv}
     * under {@code absoluteResultsDir} using the absolute {@code absoluteContPath}
     * and {@code absoluteMonitorPath} JSON files.
     */
    public synchronized String runContingency(String format, String absoluteCasePath,
            String absoluteContPath, String absoluteMonitorPath,
            String absoluteResultsDir, String stem) {
        try {
            AclfNetwork net = repo.getAclfNetBase();
            if (net == null || loadedInput == null || !loadedInput.equals(absoluteCasePath)) {
                net = NetworkLoader.loadNetwork(format, absoluteCasePath);
                repo.setAclfNetBase(net);
                loadedInput = absoluteCasePath;
            }
            Path resultsDir = Paths.get(absoluteResultsDir);
            Files.createDirectories(resultsDir);
            ContingencyRunner.runOnNet(net, resultsDir, stem,
                    Paths.get(absoluteContPath), Paths.get(absoluteMonitorPath));
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("format", format);
            o.addProperty("input", absoluteCasePath);
            o.addProperty("contingencyFile", stem + "_DF_contingency.csv");
            return GSON.toJson(o);
        } catch (Exception e) {
            return error(e);
        }
    }

    /**
     * In-memory summary from the cached net. {@code scope} ∈ net|bus|gen|load|branch;
     * {@code sortRule} is a human-readable ordering such as "Lowest Bus Voltage".
     */
    public synchronized String summarize(String scope, String sortRule, int numRec) {
        try {
            AclfNetwork net = repo.getAclfNetBase();
            if (net == null) {
                JsonObject e = new JsonObject();
                e.addProperty("ok", false);
                e.addProperty("error", "no loaded network (run loadCase or runAclf first)");
                return GSON.toJson(e);
            }
            AclfResultContainer container = buildAdapter(scope, sortRule, numRec).accept(net);
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("scope", scope);
            o.addProperty("text", container.toString());
            return GSON.toJson(o);
        } catch (Exception e) {
            return error(e);
        }
    }

    /** {@link IpssNetworkInfo#format(AclfNetwork)} on the cached base case. */
    public synchronized String getNetworkInfo() {
        AclfNetwork net = repo.getAclfNetBase();
        if (net == null) {
            return "";
        }
        return IpssNetworkInfo.format(net);
    }

    /** Drop the cached base case so it can be garbage collected. */
    public synchronized void clear() {
        repo.setAclfNetBase(null);
        loadedInput = null;
    }

    /**
     * Generate a Markdown report from CSV outputs under {@code resultDirRelative}.
     * {@code reportType} is {@code nerc} or {@code aclf}.
     * {@code absoluteProjectRoot} is the ipss-agent repository root (contains {@code wspace/} and {@code config/}).
     */
    public synchronized String runReport(
            String reportType,
            String displayName,
            String absoluteProjectRoot,
            String resultDirRelative,
            String csvPrefix) {
        try {
            ProjectPaths paths = new ProjectPaths(Paths.get(absoluteProjectRoot));
            ReportRunner runner = new ReportRunner(paths);
            ReportType type = ReportType.parse(reportType);
            ReportRunner.ReportOutput output = runner.run(type, displayName, resultDirRelative, csvPrefix);
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("markdown", output.markdown());
            o.addProperty("resultDir", output.resultDirRelative());
            o.addProperty("reportFile", output.reportFile().getFileName().toString());
            o.addProperty("displayName", displayName);
            return GSON.toJson(o);
        } catch (Exception e) {
            return error(e);
        }
    }

    private AclfResultAdapter buildAdapter(String scope, String sortRule, int numRec) {
        AclfResultAdapter a = new AclfResultAdapter();
        int n = numRec > 0 ? numRec : AclfResultAdapter.MaxNumOfResults;
        String s = scope == null ? "" : scope.toLowerCase();
        switch (s) {
            case "bus":
                if (sortRule != null && sortRule.contains("High")) {
                    a.busComparator(AclfResultAdapter.busVoltHigherComparator);
                } else {
                    a.busComparator(AclfResultAdapter.busVoltLowerComparator);
                }
                return a.numOfBusResults(n);
            case "branch":
                return a.branchComparator(AclfResultAdapter.branchFlowLargerComparator).numOfBranchResults(n);
            case "gen":
                return a.genComparator(AclfResultAdapter.genLargerComparator).numOfGenResults(n);
            case "load":
                return a.loadComparator(AclfResultAdapter.loadLargerComparator).numOfLoadResults(n);
            case "net":
            default:
                return a.numOfBusResults(n).numOfBranchResults(n).numOfGenResults(n).numOfLoadResults(n);
        }
    }

    private String error(Exception e) {
        JsonObject o = new JsonObject();
        o.addProperty("ok", false);
        o.addProperty("error", e.getMessage() == null ? e.toString() : e.getMessage());
        return GSON.toJson(o);
    }
}
