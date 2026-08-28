package org.interpss.agent.support;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import org.interpss.agent.util.ProjectPaths;

public final class AgentTestSupport {

    public static final String IEEE14_CASE = "cases/ieee14/ieee14.ieee";
    public static final String IEEE14_INPUT = "data/ieee/Ieee14Bus/ieee14.ieee";
    public static final String IEEE14_CONT = "data/ieee/Ieee14Bus/ieee14_contingencies.json";
    public static final String IEEE14_MONITOR = "data/ieee/Ieee14Bus/ieee14_monitored.json";
    public static final String IEEE14_ACLF_CONFIG = "cases/ieee14/config/aclf_run.json";
    public static final String PSSE9_CASE = "cases/psse/ieee9_v33.raw";

    private AgentTestSupport() {
    }

    public static ProjectPaths createProjectLayout(Path tempDir) throws IOException {
        Files.createDirectories(tempDir.resolve("config"));
        Files.createDirectories(tempDir.resolve("wspace"));
        copyResourceToPath(IEEE14_ACLF_CONFIG, tempDir.resolve("config/aclf_run.json"));
        return new ProjectPaths(tempDir);
    }

    public static Path copyResourceToWspace(ProjectPaths paths, String resourcePath, String wspaceRelative)
            throws IOException {
        Path target = paths.resolveWspace(wspaceRelative);
        Files.createDirectories(target.getParent());
        copyResourceToPath(resourcePath, target);
        return target;
    }

    public static Path resourcePath(String resourcePath) {
        return Path.of("src/test/resources", resourcePath);
    }

    public static Path absoluteResourcePath(String resourcePath) throws IOException {
        Path fromClasspath = copyResourceToTemp(resourcePath);
        return fromClasspath.toAbsolutePath().normalize();
    }

    public static Path copyResourceToTemp(String resourcePath) throws IOException {
        Path temp = Files.createTempFile("ipss-agent-test-", "-" + Path.of(resourcePath).getFileName());
        temp.toFile().deleteOnExit();
        copyResourceToPath(resourcePath, temp);
        return temp;
    }

    public static void copyResourceToPath(String resourcePath, Path target) throws IOException {
        try (InputStream in = AgentTestSupport.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (in == null) {
                throw new IOException("Test resource not found on classpath: " + resourcePath);
            }
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public static void setupIeee14Case(ProjectPaths paths) throws IOException {
        copyResourceToWspace(paths, IEEE14_CASE, IEEE14_INPUT);
        copyResourceToWspace(paths, "cases/ieee14/ieee14_contingencies.json", IEEE14_CONT);
        copyResourceToWspace(paths, "cases/ieee14/ieee14_monitored.json", IEEE14_MONITOR);
        copyResourceToWspace(paths, IEEE14_ACLF_CONFIG,
                "data/ieee/Ieee14Bus/config/aclf_run.json");
    }
}
