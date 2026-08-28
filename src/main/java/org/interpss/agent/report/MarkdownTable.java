package org.interpss.agent.report;

public final class MarkdownTable {

    private MarkdownTable() {
    }

    public static String row(Object... cells) {
        StringBuilder sb = new StringBuilder("| ");
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) {
                sb.append(" | ");
            }
            sb.append(cells[i] == null ? "" : cells[i]);
        }
        return sb.append(" |").toString();
    }

    public static String separator(int ncols) {
        StringBuilder sb = new StringBuilder("|");
        for (int i = 0; i < ncols; i++) {
            sb.append(" --- |");
        }
        return sb.toString();
    }

    public static String statusBadge(boolean passed) {
        return passed ? "**PASS**" : "**FAIL**";
    }
}
