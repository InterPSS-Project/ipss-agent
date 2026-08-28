package org.interpss.agent.support;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import org.interpss.agent.util.ProjectPaths;

public final class ReportTestSupport {

    public static final String IEEE118_RESULT = "data/ieee/Ieee118Bus/result";
    public static final String IEEE14_RESULT = "data/ieee/Ieee14Bus/result";

    private ReportTestSupport() {
    }

    public static Path findProjectRoot() {
        Path projectRoot = Path.of(".").toAbsolutePath().normalize();
        if (!Files.isDirectory(projectRoot.resolve("wspace"))) {
            projectRoot = projectRoot.getParent();
        }
        return projectRoot;
    }

    public static ProjectPaths createReportProjectLayout(Path tempDir) throws IOException {
        Path projectRoot = findProjectRoot();
        Files.createDirectories(tempDir.resolve("config"));
        Files.createDirectories(tempDir.resolve("wspace"));
        Files.copy(projectRoot.resolve("config/aclf_run.json"), tempDir.resolve("config/aclf_run.json"));
        Files.copy(projectRoot.resolve("config/gen_report.json"), tempDir.resolve("config/gen_report.json"));
        return new ProjectPaths(tempDir);
    }

    public static void installFixtures(ProjectPaths paths, String fixtureName, String resultRelative)
            throws IOException {
        Path targetDir = paths.resolveWspace(resultRelative);
        Files.createDirectories(targetDir);
        Path fixturePath = AgentTestSupport.resourcePath("report-fixtures/" + fixtureName + "/result");
        if (!Files.isDirectory(fixturePath)) {
            throw new IOException("Fixture directory not found: " + fixturePath);
        }
        try (Stream<Path> files = Files.list(fixturePath)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                Files.copy(file, targetDir.resolve(file.getFileName().toString()),
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        }
    }

    public static String readGolden(String name) throws IOException {
        return Files.readString(goldenPath(name));
    }

    public static Path goldenPath(String name) {
        return AgentTestSupport.resourcePath("report-golden/" + name);
    }
}
