package org.interpss.agent.cli;

import org.interpss.agent.report.ReportType;

/**
 * Parsed command-line arguments for {@code IpssCmd report ...}.
 */
public record ReportCliArgs(ReportType reportType, String displayName, String resultDir, String csvPrefix) {

    public static ReportCliArgs parseValidated(String[] args) {
        if (args.length < 4) {
            throw new IllegalArgumentException("Too few arguments for report command");
        }
        if (!"report".equals(args[0])) {
            throw new IllegalArgumentException("Expected first argument 'report'");
        }
        ReportType type = ReportType.parse(args[1]);
        String displayName = args[2];
        String resultDir = args[3];
        String csvPrefix = args.length > 4 ? args[4] : null;
        if (displayName.isBlank()) {
            throw new IllegalArgumentException("display name must not be blank");
        }
        if (resultDir.isBlank()) {
            throw new IllegalArgumentException("result_dir must not be blank");
        }
        return new ReportCliArgs(type, displayName, resultDir, csvPrefix);
    }

    public static ReportCliArgs parse(String[] args) {
        try {
            return parseValidated(args);
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            printUsage();
            System.exit(1);
            throw new IllegalStateException();
        }
    }

    public static void printUsage() {
        System.err.println("Usage: IpssCmd report <nerc|aclf> <display_name> <result_dir> [csv_prefix]");
        System.err.println("  result_dir is relative to wspace/, absolute, or legacy wspace/result/<subdir>");
        System.err.println("Examples:");
        System.err.println("  IpssCmd report nerc \"IEEE 118-Bus Test Case\" data/ieee/Ieee118Bus/result");
        System.err.println("  IpssCmd report aclf \"IEEE 14-Bus System\" data/ieee/Ieee14Bus/result ieee14");
    }
}
