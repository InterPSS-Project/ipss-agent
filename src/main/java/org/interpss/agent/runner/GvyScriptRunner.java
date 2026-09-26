package org.interpss.agent.runner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.math3.complex.Complex;
import org.interpss.agent.script.gvy.AclfNetDshGvyScriptProcessor;
import org.interpss.numeric.datatype.Unit.UnitType;

import com.interpss.core.aclf.AclfNetwork;

/**
 * Evaluates Groovy source against a live {@link AclfNetwork} — either the text of a
 * {@code .gvy} file ({@link #runOnNet(AclfNetwork, Path)}) or an inline string
 * ({@link #runSourceOnNet(AclfNetwork, String, String)}), the adapter's two entry points.
 *
 * <p>The script sees the network under the {@code aclfnet} binding (plus {@code senAlgo},
 * the DC sensitivity analyser) and mutates it in place — the same instance, with no
 * copy-on-eval and no rollback — exactly as {@link AclfNetDshGvyScriptProcessor} defines
 * it. {@code Complex} and the sensitivity imports are available without an import because
 * {@code BaseDshGvyScriptProcessor} prepends {@code GVY_IMPORTS}.
 *
 * <p>File I/O stays here, outside the processor: the processor only evaluates strings.
 */
public final class GvyScriptRunner {

    /** Refuse anything larger; scenario scripts are a few lines, not datasets. */
    public static final long MAX_SCRIPT_BYTES = 256 * 1024;

    /**
     * Lines {@code GVY_IMPORTS} prepends to every script, so a stack line can be mapped
     * back to the caller's own line numbering.
     */
    private static final int GVY_IMPORT_LINES = countLines(AclfNetDshGvyScriptProcessor.GVY_IMPORTS);

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
        return runSourceOnNet(net, code, scriptFile.toString());
    }

    /**
     * Evaluate Groovy {@code code} against {@code net}, which is mutated in place — the
     * processor's inline entry point, so a caller need not write a {@code .gvy} file.
     * {@code label} names the script in the returned digest (the file path for
     * {@link #runOnNet(AclfNetwork, Path)}, a description of the source otherwise).
     */
    public static Result runSourceOnNet(AclfNetwork net, String code, String label) throws ScriptError {
        if (net == null) {
            throw new ScriptError("no network is loaded", 0, null);
        }
        if (code == null || code.isBlank()) {
            throw new ScriptError("the script source is empty", 0, null);
        }
        long size = code.getBytes(StandardCharsets.UTF_8).length;
        if (size > MAX_SCRIPT_BYTES) {
            throw new ScriptError("script is too large (" + size + " bytes; limit " + MAX_SCRIPT_BYTES + ")", 0, null);
        }
        double loadBefore = totalLoadMw(net);
        double genBefore = totalGenerationMw(net);

        long started = System.nanoTime();
        Object returned;
        try {
            returned = new AclfNetDshGvyScriptProcessor(net).evaluate(code);
        } catch (RuntimeException | Error e) {
            throw new ScriptError(describe(e), scriptLine(e), e);
        }
        long elapsedMs = (System.nanoTime() - started) / 1_000_000L;

        Reported reported = reported(returned);
        return new Result(
                label == null || label.isBlank() ? "inline Groovy" : label,
                reported.value, reported.type, elapsedMs,
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

    /**
     * 1-based line <em>in the caller's script</em> from a Groovy stack trace, or 0 when the
     * stack does not identify one. Groovy numbers the generated class, which starts with
     * {@code GVY_IMPORTS}, so the prepended import lines are subtracted here — otherwise
     * every failure would be reported four lines below the text the caller wrote.
     */
    static int scriptLine(Throwable e) {
        int generated = generatedScriptLine(e);
        if (generated <= 0) {
            return 0;
        }
        int line = generated - GVY_IMPORT_LINES;
        return line > 0 ? line : 1;
    }

    /** The raw line in the generated script class, imports included, or 0 when absent. */
    static int generatedScriptLine(Throwable e) {
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

    /** Physical lines in {@code text} — what a Groovy prefix of that text shifts by. */
    private static int countLines(String text) {
        if (text == null || text.isEmpty()) {
            return 0;
        }
        int lines = 0;
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                lines++;
            }
        }
        // A prefix that does not end in a newline would run into the script's first line.
        return text.charAt(text.length() - 1) == '\n' ? lines : lines + 1;
    }
}
