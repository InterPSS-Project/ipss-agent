package org.interpss.agent.report;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

import org.interpss.agent.util.ProjectPaths;

public final class ReportCaseResolver {

    public record ResolvedCase(Path caseBase, String prefix) {
    }

    public record LegacyCaseConfig(String dir, String prefix, String name, String source) {
    }

    private static final Map<String, String> KNOWN_CASE_ALIASES = Map.of(
            "ieee", "ieee118",
            "texas", "texas2k");

    private ReportCaseResolver() {
    }

    public static Path resolveCaseBase(ProjectPaths paths, String resultDir) throws IOException {
        Path p = Path.of(resultDir);
        List<Path> candidates = new ArrayList<>();
        if (p.isAbsolute()) {
            candidates.add(p);
        } else {
            candidates.add(paths.resolveWspace(resultDir));
            candidates.add(paths.wspaceDir().resolve("result").resolve(resultDir));
        }

        List<String> tried = new ArrayList<>();
        for (Path base : candidates) {
            Path resolved = base.normalize().toAbsolutePath();
            tried.add(resolved.toString());
            if (Files.isDirectory(resolved) && hasBusCsv(resolved)) {
                return resolved;
            }
        }
        throw new IOException("No *_DF_bus.csv found for result_dir=" + resultDir + ". Tried: "
                + String.join(", ", tried));
    }

    public static String resolvePrefix(Path caseBase, String csvPrefix) throws IOException {
        List<String> required = List.of("_DF_branch.csv", "_DF_gen.csv", "_DF_load.csv");

        if (csvPrefix != null) {
            String prefix = csvPrefix.strip();
            if (prefix.isEmpty()) {
                throw new IllegalArgumentException("csv_prefix must be non-empty when provided.");
            }
            Path busPath = caseBase.resolve(prefix + "_DF_bus.csv");
            if (!Files.isRegularFile(busPath)) {
                throw new IOException("No " + prefix + "_DF_bus.csv under " + caseBase
                        + ". Run ACLF first.");
            }
            List<String> missing = new ArrayList<>();
            for (String suffix : required) {
                if (!Files.isRegularFile(caseBase.resolve(prefix + suffix))) {
                    missing.add(suffix);
                }
            }
            if (!missing.isEmpty()) {
                throw new IOException("Missing required ACLF CSVs for prefix '" + prefix + "' in "
                        + caseBase + ": " + String.join(", ", missing));
            }
            return prefix;
        }

        List<Path> busFiles;
        try (Stream<Path> stream = Files.list(caseBase)) {
            busFiles = stream.filter(p -> p.getFileName().toString().endsWith("_DF_bus.csv"))
                    .sorted(Comparator.comparing(p -> p.getFileName().toString()))
                    .toList();
        }
        if (busFiles.isEmpty()) {
            throw new IOException("No *_DF_bus.csv files found under " + caseBase + ". Run ACLF first.");
        }
        String prefix = busFiles.get(0).getFileName().toString().replace("_DF_bus.csv", "");
        List<String> missing = new ArrayList<>();
        for (String suffix : required) {
            if (!Files.isRegularFile(caseBase.resolve(prefix + suffix))) {
                missing.add(suffix);
            }
        }
        if (!missing.isEmpty()) {
            throw new IOException("Missing required ACLF CSVs for prefix '" + prefix + "' in "
                    + caseBase + ": " + String.join(", ", missing));
        }
        return prefix;
    }

    public static ResolvedCase resolve(ProjectPaths paths, String resultDir, String csvPrefix)
            throws IOException {
        Path caseBase = resolveCaseBase(paths, resultDir);
        String prefix = resolvePrefix(caseBase, csvPrefix);
        return new ResolvedCase(caseBase, prefix);
    }

    public static Map<String, LegacyCaseConfig> discoverLegacyCases(Path wspaceDir) throws IOException {
        Map<String, LegacyCaseConfig> discovered = new LinkedHashMap<>();
        Path resultDir = wspaceDir.resolve("result");
        if (!Files.isDirectory(resultDir)) {
            return discovered;
        }

        List<Path> casePaths;
        try (Stream<Path> stream = Files.list(resultDir)) {
            casePaths = stream.filter(Files::isDirectory).sorted(Comparator.comparing(Path::getFileName)).toList();
        }

        for (Path casePath : casePaths) {
            List<Path> busFiles;
            try (Stream<Path> stream = Files.list(casePath)) {
                busFiles = stream.filter(p -> p.getFileName().toString().endsWith("_DF_bus.csv")).toList();
            }
            if (busFiles.isEmpty()) {
                continue;
            }

            for (Path busFile : busFiles) {
                String prefix = busFile.getFileName().toString().replace("_DF_bus.csv", "");
                if (!Files.isRegularFile(casePath.resolve(prefix + "_DF_branch.csv"))
                        || !Files.isRegularFile(casePath.resolve(prefix + "_DF_gen.csv"))
                        || !Files.isRegularFile(casePath.resolve(prefix + "_DF_load.csv"))) {
                    continue;
                }

                LegacyCaseConfig cfg = new LegacyCaseConfig(
                        casePath.getFileName().toString(),
                        prefix,
                        prefix,
                        "`result/" + casePath.getFileName() + "` (auto-discovered)");

                discovered.put(casePath.getFileName().toString(), cfg);
                discovered.put(casePath.getFileName().toString().toLowerCase(Locale.ROOT), cfg);
                discovered.put(prefix, cfg);
                discovered.put(prefix.toLowerCase(Locale.ROOT), cfg);

                String lowerDir = casePath.getFileName().toString().toLowerCase(Locale.ROOT);
                for (Map.Entry<String, String> alias : KNOWN_CASE_ALIASES.entrySet()) {
                    if (lowerDir.contains(alias.getKey())) {
                        discovered.put(alias.getValue(), cfg);
                    }
                }
            }
        }
        return discovered;
    }

    public static LegacyCaseConfig getLegacyCase(ProjectPaths paths, String caseName) throws IOException {
        Map<String, LegacyCaseConfig> cases = discoverLegacyCases(paths.wspaceDir());
        LegacyCaseConfig cfg = cases.get(caseName);
        if (cfg == null) {
            cfg = cases.get(caseName.toLowerCase(Locale.ROOT));
        }
        if (cfg == null) {
            throw new IllegalArgumentException("Unknown case '" + caseName + "'. Available: "
                    + String.join(", ", cases.keySet().stream().sorted().toList()));
        }
        return cfg;
    }

    public static String sourceDescription(ProjectPaths paths, Path caseBase) {
        Path wspace = paths.wspaceDir().normalize().toAbsolutePath();
        Path normalized = caseBase.normalize().toAbsolutePath();
        if (normalized.startsWith(wspace)) {
            return "`" + wspace.relativize(normalized).toString().replace('\\', '/') + "`";
        }
        return "`" + normalized + "`";
    }

    private static boolean hasBusCsv(Path dir) throws IOException {
        try (Stream<Path> stream = Files.list(dir)) {
            return stream.anyMatch(p -> p.getFileName().toString().endsWith("_DF_bus.csv"));
        }
    }
}
