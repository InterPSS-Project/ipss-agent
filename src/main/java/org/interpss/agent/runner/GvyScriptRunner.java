package org.interpss.agent.runner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.math3.complex.Complex;
import org.interpss.numeric.datatype.Unit.UnitType;
import org.interpss.script.gvy.AclfNetGvyScriptProcessor;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Evaluates a Groovy {@code .gvy} script against a live {@link AclfNetwork}.
 *
 * <p>The script sees the network under the {@code aclfnet} binding and mutates it in
 * place — the same instance, with no copy-on-eval and no rollback — exactly as
 * {@link AclfNetGvyScriptProcessor} defines it. {@code Complex} is available without an
 * import because {@code BaseGvyScriptProcessor} prepends {@code GVY_IMPORTS}.
 *
 * <p>File I/O stays here, outside the processor: the processor only evaluates strings.
 */
public final class GvyScriptRunner {

    /** Refuse anything larger; scenario scripts are a few lines, not datasets. */
    public static final long MAX_SCRIPT_BYTES = 256 * 1024;

    /** The generated script class, used to pull a line number out of a failing stack. */
    private static final Pattern SCRIPT_LINE = Pattern.compile("Script\\d*\\.groovy:(\\d+)");

    private GvyScriptRunner() {
    }

    /** What one script evaluation did, with enough scalars to see that it did anything. */
    public static final class Result {

        public final String script;
        public final String returnValue;
        public final String returnType;
        public final long elapsedMs;
        public final int busCount;
        public final int branchCount;
        public final double loadMw;
        public final double generationMw;
        public final double loadMwBefore;
        public final double generationMwBefore;
        public final boolean lfConverged;

        Result(String script, String returnValue, String returnType, long elapsedMs,
                int busCount, int branchCount, double loadMw, double generationMw,
                double loadMwBefore, double generationMwBefore, boolean lfConverged) {
            this.script = script;
            this.returnValue = returnValue;
            this.returnType = returnType;
            this.elapsedMs = elapsedMs;
            this.busCount = busCount;
            this.branchCount = branchCount;
            this.loadMw = loadMw;
            this.generationMw = generationMw;
            this.loadMwBefore = loadMwBefore;
            this.generationMwBefore = generationMwBefore;
            this.lfConverged = lfConverged;
        }
    }

    /** A Groovy failure translated for the JSON bridge: message + script line when known. */
    public static final class ScriptError extends Exception {

        private final int line;

        ScriptError(String message, int line, Throwable cause) {
            super(message, cause);
            this.line = line;
        }

        /** 1-based line in the script, or 0 when the stack did not identify one. */
        public int line() {
            return line;
        }
    }

    /**
     * Read {@code scriptFile} and evaluate it against {@code net}, which is mutated in
     * place. The returned digest is measured around the evaluation, so a mutation-only
     * script still reports what it changed.
     */
    public static Result runOnNet(AclfNetwork net, Path scriptFile) throws IOException, ScriptError {
        if (net == null) {
            throw new ScriptError("no network is loaded", 0, null);
        }
        if (scriptFile == null || !Files.isRegularFile(scriptFile)) {
            throw new IOException("script file not found: " + scriptFile);
        }
        long size = Files.size(scriptFile);
        if (size > MAX_SCRIPT_BYTES) {
            throw new IOException("script is too large (" + size + " bytes; limit " + MAX_SCRIPT_BYTES + ")");
        }

        String code = Files.readString(scriptFile, StandardCharsets.UTF_8);
        double loadBefore = totalLoadMw(net);
        double genBefore = totalGenerationMw(net);

        long started = System.nanoTime();
        Object returned;
        try {
            returned = new AclfNetGvyScriptProcessor(net).evaluate(code);
        } catch (RuntimeException | Error e) {
            throw new ScriptError(describe(e), scriptLine(e), e);
        }
        long elapsedMs = (System.nanoTime() - started) / 1_000_000L;

        Reported reported = reported(returned);
        return new Result(
                scriptFile.toString(), reported.value, reported.type, elapsedMs,
                net.getNoActiveBus(), net.getNoActiveBranch(),
                totalLoadMw(net), totalGenerationMw(net),
                loadBefore, genBefore, net.isLfConverged());
    }

    private static double totalLoadMw(AclfNetwork net) {
        return net.totalLoad(UnitType.mVA).getReal();
    }

    private static double totalGenerationMw(AclfNetwork net) {
        return net.totalGeneration(UnitType.mVA).getReal();
    }

    /** A value safe to put in JSON: only scalars are rendered, never a live model object. */
    private static final class Reported {

        final String value;
        final String type;

        Reported(String value, String type) {
            this.value = value;
            this.type = type;
        }
    }

    private static Reported reported(Object returned) {
        if (returned == null) {
            return new Reported(null, null);
        }
        if (returned instanceof CharSequence || returned instanceof Number
                || returned instanceof Boolean || returned instanceof Character
                || returned instanceof Complex) {
            return new Reported(String.valueOf(returned), null);
        }
        // Never call toString() on an InterPSS/EMF object: it can walk the whole model.
        return new Reported(null, returned.getClass().getSimpleName());
    }

    /** One-line message for the model: exception type + first message line. */
    static String describe(Throwable e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        int newline = message.indexOf('\n');
        if (newline >= 0) {
            message = message.substring(0, newline);
        }
        String name = e.getClass().getSimpleName();
        return message.isEmpty() ? name : name + ": " + message.trim();
    }

    /** 1-based script line from a Groovy stack trace, or 0 when absent. */
    static int scriptLine(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            for (StackTraceElement frame : t.getStackTrace()) {
                if (frame.getClassName().startsWith("Script")) {
                    return frame.getLineNumber();
                }
            }
            Matcher m = SCRIPT_LINE.matcher(String.valueOf(t));
            if (m.find()) {
                return Integer.parseInt(m.group(1));
            }
        }
        return 0;
    }
}
