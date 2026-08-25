package org.interpss.agent.util;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Resolves ipss-agent project root, wspace-relative paths, and result output locations.
 */
public final class ProjectPaths {

    private final Path projectRoot;
    private final Path wspaceDir;

    public ProjectPaths(Path projectRoot) {
        this.projectRoot = projectRoot.normalize().toAbsolutePath();
        this.wspaceDir = this.projectRoot.resolve("wspace");
        if (!Files.isDirectory(this.wspaceDir)) {
            throw new IllegalStateException("wspace directory not found under project root: " + this.projectRoot);
        }
    }

    public static ProjectPaths discover() {
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        if (Files.isDirectory(cwd.resolve("wspace")) && Files.isDirectory(cwd.resolve("config"))) {
            return new ProjectPaths(cwd);
        }
        Path here = Paths.get(System.getProperty("user.dir")).normalize();
        if (Files.isDirectory(here.resolve("wspace")) && Files.isDirectory(here.resolve("config"))) {
            return new ProjectPaths(here);
        }
        Path fromWspace = here.getParent();
        if (fromWspace != null
                && Files.isDirectory(fromWspace.resolve("wspace"))
                && Files.isDirectory(fromWspace.resolve("config"))) {
            return new ProjectPaths(fromWspace);
        }
        throw new IllegalStateException(
                "Could not find ipss-agent project root (need wspace/ and config/). "
                        + "Run from project root or wspace/.");
    }

    public Path projectRoot() {
        return projectRoot;
    }

    public Path wspaceDir() {
        return wspaceDir;
    }

    /** Resolve a path relative to {@code wspace/}. */
    public Path resolveWspace(String relativePath) {
        return wspaceDir.resolve(relativePath).normalize();
    }

    /** Parent directory of the case file, relative to wspace (e.g. {@code data/ieee/Ieee118Bus}). */
    public static String inputParentRelative(String inputRelative) {
        Path p = Paths.get(inputRelative);
        Path parent = p.getParent();
        return parent == null ? "" : parent.toString().replace('\\', '/');
    }

    /** Basename without extension (e.g. {@code ieee118} from {@code ieee118.ieee}). */
    public static String outputStem(String inputRelative) {
        String name = Paths.get(inputRelative).getFileName().toString();
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    public Path resultsDir(String inputRelative) throws IOException {
        String parent = inputParentRelative(inputRelative);
        Path dir = parent.isEmpty() ? wspaceDir.resolve("result") : wspaceDir.resolve(parent).resolve("result");
        Files.createDirectories(dir);
        return dir;
    }

    public Path defaultAclfRunConfig() {
        return projectRoot.resolve("config").resolve("aclf_run.json");
    }

    public Path caseAclfRunConfig(String inputRelative) {
        String parent = inputParentRelative(inputRelative);
        if (parent.isEmpty()) {
            return wspaceDir.resolve("config").resolve("aclf_run.json");
        }
        return wspaceDir.resolve(parent).resolve("config").resolve("aclf_run.json");
    }

    public Path resolveAclfRunConfig(String inputRelative) {
        Path caseConfig = caseAclfRunConfig(inputRelative);
        if (Files.isRegularFile(caseConfig)) {
            return caseConfig;
        }
        return defaultAclfRunConfig();
    }
}
