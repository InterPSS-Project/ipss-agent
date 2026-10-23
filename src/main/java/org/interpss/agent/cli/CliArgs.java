package org.interpss.agent.cli;

/**
 * Parsed command-line arguments for {@link org.interpss.agent.IpssCmd}.
 */
public record CliArgs(String simutype, String format, String input, String contFile, String monitorFile) {

    public static CliArgs parse(String[] args) {
        try {
            return parseValidated(args);
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            printUsage();
            System.exit(1);
            throw new IllegalStateException();
        }
    }

    public static CliArgs parseValidated(String[] args) {
        if (args.length < 3) {
            throw new IllegalArgumentException("Too few arguments: expected at least 3");
        }
        String simutype = args[0];
        String format = args[1];
        String input = args[2];
        String contFile = args.length > 3 ? args[3] : null;
        String monitorFile = args.length > 4 ? args[4] : null;

        if (!simutype.equals("aclf") && !simutype.equals("ca") && !simutype.equals("optadj")) {
            throw new IllegalArgumentException("Invalid simulation type: " + simutype);
        }
        if (!format.equals("ieee") && !format.equals("psse") && !format.equals("bpa")) {
            throw new IllegalArgumentException("Invalid format: " + format);
        }
        // OptAdj has no monitored-branch list (the SSA scan is the monitored set), so a second
        // positional argument is a mistake rather than something to ignore.
        if (simutype.equals("optadj") && monitorFile != null) {
            throw new IllegalArgumentException(
                    "The optadj simulation type takes at most one file argument (the contingency file)");
        }
        return new CliArgs(simutype, format, input, contFile, monitorFile);
    }

    public static void printUsage() {
        System.err.println("Usage: IpssCmd <simutype> <format> <input> [<cont_file> [<monitor_file>]]");
        System.err.println("  simutype: aclf | ca | optadj");
        System.err.println("  format:   ieee | psse | bpa");
        System.err.println("  ca:       cont_file + monitor_file select the inputs");
        System.err.println("  optadj:   cont_file is the N-1 contingency file (genAdjCA_N-1 mode only)");
        System.err.println("  paths are relative to wspace/");
    }
}
