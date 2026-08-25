package org.interpss.agent.cli;

/**
 * Parsed command-line arguments for {@link org.interpss.agent.IpssCmd}.
 */
public record CliArgs(String simutype, String format, String input, String contFile, String monitorFile) {

    public static CliArgs parse(String[] args) {
        if (args.length < 3) {
            printUsage();
            System.exit(1);
        }
        String simutype = args[0];
        String format = args[1];
        String input = args[2];
        String contFile = args.length > 3 ? args[3] : null;
        String monitorFile = args.length > 4 ? args[4] : null;

        if (!simutype.equals("aclf") && !simutype.equals("ca")) {
            System.err.println("Invalid simulation type: " + simutype);
            printUsage();
            System.exit(1);
        }
        if (!format.equals("ieee") && !format.equals("psse")) {
            System.err.println("Invalid format: " + format);
            printUsage();
            System.exit(1);
        }
        return new CliArgs(simutype, format, input, contFile, monitorFile);
    }

    public static void printUsage() {
        System.err.println("Usage: IpssCmd <simutype> <format> <input> [<cont_file> <monitor_file>]");
        System.err.println("  simutype: aclf | ca");
        System.err.println("  format:   ieee | psse");
        System.err.println("  paths are relative to wspace/");
    }
}
