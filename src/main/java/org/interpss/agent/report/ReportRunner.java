package org.interpss.agent.report;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;

import org.interpss.agent.util.ProjectPaths;

public final class ReportRunner {

    public record ReportOutput(
            String markdown,
            Path caseBase,
            Path reportFile,
            String resultDirRelative) {
    }

    private final ProjectPaths paths;
    private final ReportConfig config;
    private final Clock clock;

    public ReportRunner(ProjectPaths paths) throws IOException {
        this(paths, ReportConfig.load(paths.projectRoot()), Clock.systemDefaultZone());
    }

    public ReportRunner(ProjectPaths paths, ReportConfig config, Clock clock) {
        this.paths = paths;
        this.config = config;
        this.clock = clock;
    }

    public ReportOutput run(ReportType type, String displayName, String resultDir, String csvPrefix)
            throws IOException {
        String markdown;
        Path caseBase;

        switch (type) {
            case ACLF -> {
                AclfReportGenerator.ReportResult result = AclfReportGenerator.generate(
                        paths, config, displayName, resultDir, csvPrefix, clock);
                markdown = result.markdown();
                caseBase = result.caseBase();
            }
            case NERC -> {
                NercTplReportGenerator.ReportResult result = NercTplReportGenerator.generate(
                        paths, config, displayName, resultDir, clock);
                markdown = result.markdown();
                caseBase = result.caseBase();
            }
            default -> throw new IllegalArgumentException("Unsupported report type: " + type);
        }

        Path reportFile = caseBase.resolve(type.outputFileName());
        Files.writeString(reportFile, markdown, StandardCharsets.UTF_8);

        Path wspace = paths.wspaceDir().normalize().toAbsolutePath();
        String resultDirRelative = wspace.relativize(caseBase.normalize().toAbsolutePath())
                .toString().replace('\\', '/');

        return new ReportOutput(markdown, caseBase, reportFile, resultDirRelative);
    }
}
