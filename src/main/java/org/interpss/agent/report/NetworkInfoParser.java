package org.interpss.agent.report;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

public final class NetworkInfoParser {

    public record NetworkInfo(
            Map<String, String> aclfNetwork,
            Map<String, String> loadflowRun) {
    }

    private NetworkInfoParser() {
    }

    public static NetworkInfo parse(Path caseBase, String prefix) throws IOException {
        Path filepath = caseBase.resolve(prefix + "_network_info.txt");
        if (!Files.isRegularFile(filepath)) {
            return null;
        }

        Map<String, Map<String, String>> sections = new LinkedHashMap<>();
        String currentSection = null;

        for (String line : Files.readAllLines(filepath)) {
            String stripped = line.strip();
            if (stripped.isEmpty()) {
                continue;
            }
            if (stripped.startsWith("=====") && stripped.endsWith("=====")) {
                currentSection = stripped.replace("=", "").strip().replaceAll(":$", "");
                sections.putIfAbsent(currentSection, new LinkedHashMap<>());
            } else if (stripped.contains(":") && currentSection != null) {
                int idx = stripped.indexOf(':');
                String key = stripped.substring(0, idx).strip();
                String value = stripped.substring(idx + 1).strip();
                sections.get(currentSection).put(key, value);
            }
        }

        return new NetworkInfo(
                sections.getOrDefault("Aclf Network Information", Map.of()),
                sections.getOrDefault("Loadflow Run Information", Map.of()));
    }
}
