package org.interpss.agent.report;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;

public final class CsvDataLoader {

    private CsvDataLoader() {
    }

    public static List<Map<String, String>> loadRequired(Path caseBase, String filename) throws IOException {
        Path filepath = caseBase.resolve(filename);
        if (!Files.isRegularFile(filepath)) {
            throw new IOException("Required CSV not found: " + filepath);
        }
        return load(filepath);
    }

    public static List<Map<String, String>> loadOptional(Path caseBase, String filename) throws IOException {
        Path filepath = caseBase.resolve(filename);
        if (!Files.isRegularFile(filepath)) {
            return null;
        }
        return load(filepath);
    }

    private static List<Map<String, String>> load(Path filepath) throws IOException {
        List<Map<String, String>> rows = new ArrayList<>();
        try (Reader reader = Files.newBufferedReader(filepath);
                CSVParser parser = CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).build()
                        .parse(reader)) {
            for (CSVRecord record : parser) {
                Map<String, String> row = new LinkedHashMap<>();
                for (String header : parser.getHeaderNames()) {
                    row.put(header, record.get(header));
                }
                rows.add(row);
            }
        }
        return rows;
    }
}
