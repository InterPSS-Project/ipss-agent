package org.interpss.agent.report;

public enum ReportType {
    ACLF("AC_Loadflow_Report.md"),
    NERC("NERC_TPL_001_5_Report.md");

    private final String outputFileName;

    ReportType(String outputFileName) {
        this.outputFileName = outputFileName;
    }

    public String outputFileName() {
        return outputFileName;
    }

    public static ReportType parse(String value) {
        if (value == null) {
            throw new IllegalArgumentException("report type is required");
        }
        return switch (value.toLowerCase()) {
            case "aclf" -> ACLF;
            case "nerc" -> NERC;
            default -> throw new IllegalArgumentException("Invalid report type: " + value);
        };
    }
}
