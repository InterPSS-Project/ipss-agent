package org.interpss.agent.bridge;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.interpss.agent.input.NetworkLoader;
import org.interpss.agent.model.SimuModelRepository;
import org.interpss.agent.report.ReportRunner;
import org.interpss.agent.report.ReportType;
import org.interpss.agent.runner.AclfRunner;
import org.interpss.agent.runner.ContingencyRunner;
import org.interpss.agent.runner.GvyScriptRunner;
import org.interpss.agent.util.CaRunConfig;
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
     * under {@code absoluteResultsDir}. Contingency and monitor JSON paths are
     * independently optional: null or blank uses N-1 / all-branch defaults in
     * {@link ContingencyRunner}.
     */
    public synchronized String runContingency(String format, String absoluteCasePath,
            String absoluteContPath, String absoluteMonitorPath,
            String absoluteResultsDir, String stem) {
        return runContingency(format, absoluteCasePath, absoluteContPath, absoluteMonitorPath,
                absoluteResultsDir, stem, CaRunConfig.DEFAULT_OVERLOAD_THRESHOLD);
    }

    /**
     * As above, with the violation-check loading (%) the caller asked for — the CA
     * dialog's field, the tool's `overloadThreshold`, or `config/ca_run.json`.
     */
    public synchronized String runContingency(String format, String absoluteCasePath,
            String absoluteContPath, String absoluteMonitorPath,
            String absoluteResultsDir, String stem, double overloadThreshold) {
        try {
            AclfNetwork net = repo.getAclfNetBase();
            if (net == null || loadedInput == null || !loadedInput.equals(absoluteCasePath)) {
                net = NetworkLoader.loadNetwork(format, absoluteCasePath);
                repo.setAclfNetBase(net);
                loadedInput = absoluteCasePath;
            }
            Path resultsDir = Paths.get(absoluteResultsDir);
            Files.createDirectories(resultsDir);
            ContingencyRunner.ContAnalysisSummary summary = ContingencyRunner.runOnNet(net, resultsDir, stem,
                    optionalPath(absoluteContPath), optionalPath(absoluteMonitorPath), overloadThreshold);
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("format", format);
            o.addProperty("input", absoluteCasePath);
            o.addProperty("contingencyFile", stem + "_DF_contingency.csv");
            o.addProperty("caSummary", summary.toString());
            return GSON.toJson(o);
        } catch (Exception e) {
            return error(e);
        }
    }

    /** Null or blank string → null Path (defaults in ContingencyRunner). */
    private static Path optionalPath(String absolutePath) {
        if (absolutePath == null || absolutePath.isBlank()) {
            return null;
        }
        return Paths.get(absolutePath);
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

    /**
     * Evaluate a Groovy {@code .gvy} script against the cached base case, loading it
     * first when {@code absoluteCasePath} is not the case the JVM already holds (or
     * when {@code reload} forces a fresh parse). Mutations are in place and are not
     * rolled back, so a failing script leaves what it already changed.
     *
     * <p>The script must live in the case folder's {@code scripts/} directory; the Host
     * enforces the same rule, and this check keeps a direct bridge caller honest.
     */
    public synchronized String runGvy(String format, String absoluteCasePath,
            String absoluteScriptPath, boolean reload) {
        try {
            Path script = requireScriptInCaseScriptsDir(absoluteCasePath, absoluteScriptPath);
            AclfNetwork net = repo.getAclfNetBase();
            if (reload || net == null || loadedInput == null || !loadedInput.equals(absoluteCasePath)) {
                net = NetworkLoader.loadNetwork(format, absoluteCasePath);
                repo.setAclfNetBase(net);
                loadedInput = absoluteCasePath;
            }
            GvyScriptRunner.Result result = GvyScriptRunner.runOnNet(net, script);
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("case", absoluteCasePath);
            o.addProperty("script", result.script);
            if (result.returnValue != null) {
                o.addProperty("returnValue", result.returnValue);
            }
            if (result.returnType != null) {
                o.addProperty("returnType", result.returnType);
            }
            o.addProperty("elapsedMs", result.elapsedMs);
            o.addProperty("buses", result.busCount);
            o.addProperty("branches", result.branchCount);
            o.addProperty("loadMw", result.loadMw);
            o.addProperty("generationMw", result.generationMw);
            o.addProperty("loadMwBefore", result.loadMwBefore);
            o.addProperty("generationMwBefore", result.generationMwBefore);
            o.addProperty("lfConverged", result.lfConverged);
            return GSON.toJson(o);
        } catch (GvyScriptRunner.ScriptError e) {
            JsonObject o = new JsonObject();
            o.addProperty("ok", false);
            o.addProperty("error", e.getMessage());
            if (e.line() > 0) {
                o.addProperty("line", e.line());
            }
            return GSON.toJson(o);
        } catch (Exception e) {
            return error(e);
        }
    }

    /**
     * The script must be a regular {@code .gvy} file under {@code <case folder>/scripts/}.
     * Both paths are resolved to real paths first, so {@code ..} cannot escape the folder
     * and a symlink cannot point outside it.
     */
    private static Path requireScriptInCaseScriptsDir(String absoluteCasePath, String absoluteScriptPath)
            throws IOException {
        if (absoluteScriptPath == null || absoluteScriptPath.isBlank()) {
            throw new IOException("no script path was given");
        }
        if (!absoluteScriptPath.toLowerCase().endsWith(".gvy")) {
            throw new IOException("not a Groovy script (expected a .gvy file): " + absoluteScriptPath);
        }
        Path script = Paths.get(absoluteScriptPath).toAbsolutePath().normalize();
        Path casePath = Paths.get(absoluteCasePath == null ? "" : absoluteCasePath).toAbsolutePath().normalize();
        Path caseDir = casePath.getParent();
        if (caseDir == null) {
            throw new IOException("cannot resolve the case folder of " + absoluteCasePath);
        }
        Path scriptsDir = caseDir.resolve("scripts");
        Path realScript;
        Path realScripts;
        try {
            realScript = script.toRealPath();
            realScripts = scriptsDir.toRealPath();
        } catch (IOException e) {
            throw new IOException("script not found: " + absoluteScriptPath);
        }
        if (!realScript.startsWith(realScripts)) {
            throw new IOException("the script must live in " + scriptsDir + ": " + absoluteScriptPath);
        }
        if (!Files.isRegularFile(realScript)) {
            throw new IOException("not a regular file: " + absoluteScriptPath);
        }
        return realScript;
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
