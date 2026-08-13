package com.example.backend.can.service;

import com.example.backend.can.dto.NlQueryRequest;
import com.example.backend.can.dto.NlQueryResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.influxdb.client.InfluxDBClient;
import com.influxdb.client.QueryApi;
import com.influxdb.query.FluxRecord;
import com.influxdb.query.FluxTable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
@Slf4j
public class NlQueryService {

    private final GroqClient       groqClient;
    private final InfluxDBClient   influxDBClient;
    private final JdbcTemplate     jdbcTemplate;
    private final ObjectMapper     objectMapper;

    @Value("${influxdb.bucket}")
    private String bucket;

    @Value("${influxdb.org}")
    private String influxOrg;

    private static final int     MAX_FLUX_ROWS = 1000;
    private static final int     MAX_SQL_ROWS  = 500;
    private static final Pattern SQL_MUTATION  =
            Pattern.compile("(?i)\\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE)\\b");
    private static final Pattern SQL_FILE_CLAUSE =
            Pattern.compile("(?i)\\b(INTO\\s+OUTFILE|INTO\\s+DUMPFILE|LOAD_FILE)\\b");
    private static final Pattern SQL_TABLE_REF =
            Pattern.compile("(?i)\\b(?:FROM|JOIN)\\s+`?([a-zA-Z0-9_]+)`?");
    private static final Set<String> ALLOWED_SQL_TABLES =
            Set.of("can_sessions", "cars", "integrity_faults");
    private static final Pattern FLUX_BUCKET_REF =
            Pattern.compile("from\\(bucket:\\s*\"([^\"]*)\"");
    private static final Pattern FLUX_IMPORT =
            Pattern.compile("(?i)\\bimport\\b");

    // ── System Prompt ─────────────────────────────────────────────────────────

    private static final String SYSTEM_PROMPT = """
            You are a query generator for a CAN bus telemetry platform.
            Given a natural-language question, produce the most accurate executable query.

            ════ INFLUXDB  (bucket: ecu_telemetry, org: kpit) ════

            Measurement "can_frames"  — one record per raw CAN frame
              Tags  : session_id, msg_id, msg_name, channel_name
              Fields: direction (string), raw_bytes (string), channel (int)
              Use for: frame presence, frame counts, channel activity, raw bus traffic

            Measurement "can_signals" — one record per decoded signal sample
              Tags  : session_id, msg_id, msg_name, signal_name, channel_name, label
              Fields: value (float)
              label = "INJECTED_ERROR" for injected faults, empty string otherwise
              Use for: signal values, threshold checks, timelines, injected errors

            Flux rules:
              1. MUST start exactly with: from(bucket: "ecu_telemetry")
              2. ALWAYS add: |> filter(fn: (r) => r["_measurement"] == "can_frames")
                 or          |> filter(fn: (r) => r["_measurement"] == "can_signals")
                 right after the range() — never omit this line
              3. Default time window: range(start: 0)  — use this unless the user asks for a specific window
                 range(start: 0) means "all stored data from epoch to now" — NEVER use -30d by default
              4. For can_signals queries, ALWAYS add: |> filter(fn: (r) => r["_field"] == "value")
              5. Case-insensitive tag match: use regex  r["channel_name"] =~ /^adas$/i
              6. Partial name match: use               r["signal_name"] =~ /speed/i
              7. MUST end with: |> limit(n: 1000)

            ════ MYSQL ════

            Table can_sessions:
              session_id (VARCHAR), source_filename (VARCHAR), start_ts (DOUBLE ms-since-epoch),
              end_ts (DOUBLE ms-since-epoch), status (VARCHAR: "live"|"completed"|"failed"),
              frame_count (INT), created_at (DATETIME), car_id (BIGINT)

            Table cars:
              id (BIGINT), car_uid (VARCHAR), make (VARCHAR), model (VARCHAR), year (INT),
              is_virtual (BOOLEAN), is_active (BOOLEAN)

            Table integrity_faults:
              id (BIGINT), session_id (VARCHAR), frame_id (BIGINT), msg_id (VARCHAR),
              msg_name (VARCHAR), fault_type (VARCHAR: "DUPLICATE"|"TIMING_GAP"|"SIGNAL_RANGE"),
              description (VARCHAR), frame_timestamp (DOUBLE), created_at (DATETIME)

            SQL rules:
              1. SELECT only — no INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE
              2. Use ONLY the exact column names listed above — never invent names
              3. JOIN cars: JOIN cars ON can_sessions.car_id = cars.id
              4. Duration in seconds: (end_ts - start_ts) / 1000.0
              5. Add LIMIT only when user asks for top-N

            ════ ROUTING ════

            Frames on a channel / bus activity / "are there frames"  → flux on can_frames
            Signal values / thresholds / timelines                   → flux on can_signals
            Injected errors / label queries                          → flux on can_signals
            Session list / counts / duration / status                → sql on can_sessions
            Vehicle / car info                                       → sql on cars (JOIN can_sessions if needed)
            Fault breakdown / fault counts / DUPLICATE / TIMING_GAP → sql on integrity_faults

            ════ EXAMPLES ════

            Q: are there frames on the adas channel?
            A: {"db":"flux","query":"from(bucket: \\"ecu_telemetry\\")\\n  |> range(start: 0)\\n  |> filter(fn: (r) => r[\\"_measurement\\"] == \\"can_frames\\")\\n  |> filter(fn: (r) => r[\\"channel_name\\"] =~ /^adas$/i)\\n  |> limit(n: 1000)","explanation":"Searches can_frames for any frame whose channel_name matches 'adas' (case-insensitive)."}

            Q: show me EngineSpeed values above 4000 rpm
            A: {"db":"flux","query":"from(bucket: \\"ecu_telemetry\\")\\n  |> range(start: 0)\\n  |> filter(fn: (r) => r[\\"_measurement\\"] == \\"can_signals\\")\\n  |> filter(fn: (r) => r[\\"_field\\"] == \\"value\\")\\n  |> filter(fn: (r) => r[\\"signal_name\\"] =~ /enginespeed/i)\\n  |> filter(fn: (r) => r[\\"_value\\"] > 4000.0)\\n  |> limit(n: 1000)","explanation":"Filters can_signals for EngineSpeed samples exceeding 4000."}

            Q: how many sessions are there?
            A: {"db":"sql","query":"SELECT COUNT(*) AS session_count FROM can_sessions","explanation":"Counts total sessions in the database."}

            Q: list all sessions with their duration and file name
            A: {"db":"sql","query":"SELECT session_id, source_filename, status, frame_count, ROUND((end_ts - start_ts) / 1000.0, 2) AS duration_sec, created_at FROM can_sessions ORDER BY created_at DESC","explanation":"Returns session metadata including computed duration in seconds."}

            Q: which cars have sessions and how many?
            A: {"db":"sql","query":"SELECT c.make, c.model, c.year, COUNT(s.session_id) AS session_count FROM cars c JOIN can_sessions s ON s.car_id = c.id GROUP BY c.id, c.make, c.model, c.year ORDER BY session_count DESC","explanation":"Lists cars with the number of sessions recorded for each."}

            Q: show duplicate faults for session b87d1774
            A: {"db":"sql","query":"SELECT msg_id, msg_name, fault_type, description, frame_timestamp FROM integrity_faults WHERE session_id = 'b87d1774' AND fault_type = 'DUPLICATE' ORDER BY frame_timestamp","explanation":"Returns DUPLICATE faults for the specified session ordered by timestamp."}

            Q: how many faults of each type are there across all sessions?
            A: {"db":"sql","query":"SELECT fault_type, COUNT(*) AS count FROM integrity_faults GROUP BY fault_type ORDER BY count DESC","explanation":"Counts faults grouped by type across all sessions."}

            Q: show signals where errors were injected
            A: {"db":"flux","query":"from(bucket: \\"ecu_telemetry\\")\\n  |> range(start: 0)\\n  |> filter(fn: (r) => r[\\"_measurement\\"] == \\"can_signals\\")\\n  |> filter(fn: (r) => r[\\"_field\\"] == \\"value\\")\\n  |> filter(fn: (r) => r[\\"label\\"] == \\"INJECTED_ERROR\\")\\n  |> limit(n: 1000)","explanation":"Returns signal samples marked as injected errors."}

            Q: what channels are active?
            A: {"db":"flux","query":"from(bucket: \\"ecu_telemetry\\")\\n  |> range(start: 0)\\n  |> filter(fn: (r) => r[\\"_measurement\\"] == \\"can_frames\\")\\n  |> keep(columns: [\\"channel_name\\"])\\n  |> distinct(column: \\"channel_name\\")\\n  |> limit(n: 1000)","explanation":"Returns all distinct channel names seen in CAN frames."}

            ════ OUTPUT FORMAT ════

            Return ONLY a single JSON object — no markdown, no code fences, no explanation text:
            {"db":"flux"|"sql","query":"<complete executable query>","explanation":"<one sentence>"}
            """;

    // ── Public API ────────────────────────────────────────────────────────────

    public NlQueryResponse execute(NlQueryRequest request) {
        try {
            return attemptQuery(request.question(), null);
        } catch (RuntimeException firstError) {
            log.warn("First NL query attempt failed ({}), retrying with error context", firstError.getMessage());
            try {
                return attemptQuery(request.question(), firstError.getMessage());
            } catch (RuntimeException secondError) {
                log.error("Second NL query attempt also failed: {}", secondError.getMessage());
                throw secondError;
            }
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private NlQueryResponse attemptQuery(String question, String previousError) {
        String userMessage = previousError == null
                ? question
                : question + "\n\n[Previous attempt failed: " + previousError
                  + ". Please fix the query — check column names, measurement names, and syntax.]";

        String rawLlmOutput = groqClient.complete(SYSTEM_PROMPT, userMessage);
        log.info("LLM raw output: {}", rawLlmOutput);

        String cleaned = rawLlmOutput.strip();
        if (cleaned.startsWith("```")) {
            cleaned = cleaned.replaceAll("(?s)^```[a-z]*\\s*", "").replaceAll("```\\s*$", "").strip();
        }

        JsonNode parsed;
        try {
            parsed = objectMapper.readTree(cleaned);
        } catch (Exception e) {
            throw new IllegalStateException("LLM returned non-JSON output: " + rawLlmOutput, e);
        }

        String db          = parsed.path("db").asText();
        String query       = parsed.path("query").asText();
        String explanation = parsed.path("explanation").asText();

        if (query.isBlank()) {
            throw new IllegalStateException("LLM returned an empty query");
        }

        long start = System.currentTimeMillis();
        List<Map<String, Object>> results;

        if ("flux".equals(db)) {
            validateFlux(query);
            results = executeFlux(query);
        } else if ("sql".equals(db)) {
            validateSql(query);
            results = executeSql(query);
        } else {
            throw new IllegalStateException("Unknown db type from LLM: " + db);
        }

        long executionMs = System.currentTimeMillis() - start;
        log.info("NL query executed: type={} rows={} ms={}", db, results.size(), executionMs);

        return new NlQueryResponse(db, query, explanation, results, results.size(), executionMs);
    }

    private void validateFlux(String query) {
        String trimmed = query.trim();
        if (!trimmed.startsWith("from(bucket: \"ecu_telemetry\")")) {
            throw new SecurityException("Flux query must start with from(bucket: \"ecu_telemetry\")");
        }
        if (trimmed.contains("delete(") || trimmed.contains("to(")) {
            throw new SecurityException("Flux query contains forbidden mutation operation");
        }
        // Flux requires an explicit `import "pkg"` statement before any package-qualified call
        // (http.post, experimental.*, sql.to, socket.*, csv.from, ...). None of the built-in
        // functions this feature needs (from/range/filter/keep/distinct/limit/...) require an
        // import, so rejecting the keyword outright blocks the entire SSRF/write surface.
        if (FLUX_IMPORT.matcher(trimmed).find()) {
            throw new SecurityException("Flux query must not import additional packages");
        }
        Matcher bucketMatcher = FLUX_BUCKET_REF.matcher(trimmed);
        boolean foundBucket = false;
        while (bucketMatcher.find()) {
            foundBucket = true;
            if (!"ecu_telemetry".equals(bucketMatcher.group(1))) {
                throw new SecurityException("Flux query references a bucket outside the allowed set");
            }
        }
        if (!foundBucket) {
            throw new SecurityException("Flux query must reference the ecu_telemetry bucket");
        }
    }

    private void validateSql(String query) {
        String trimmed = query.trim();
        if (!trimmed.toUpperCase().startsWith("SELECT")) {
            throw new SecurityException("SQL query must start with SELECT");
        }
        if (trimmed.contains(";")) {
            throw new SecurityException("SQL query must not contain multiple statements");
        }
        if (trimmed.contains("--") || trimmed.contains("/*")) {
            throw new SecurityException("SQL query must not contain comments");
        }
        if (SQL_MUTATION.matcher(trimmed).find() || SQL_FILE_CLAUSE.matcher(trimmed).find()) {
            throw new SecurityException("SQL query contains forbidden keyword");
        }
        // Table allow-list: even if the LLM is coaxed (via prompt injection) into emitting a
        // query against `users`, `refresh_tokens`, `mysql.user`, information_schema, etc., this
        // rejects it — the allow-list is enforced here, not left to the LLM's own judgment.
        Matcher tableMatcher = SQL_TABLE_REF.matcher(trimmed);
        boolean foundTable = false;
        while (tableMatcher.find()) {
            foundTable = true;
            String table = tableMatcher.group(1).toLowerCase();
            if (!ALLOWED_SQL_TABLES.contains(table)) {
                throw new SecurityException("SQL query references a table outside the allowed set: " + table);
            }
        }
        if (!foundTable) {
            throw new SecurityException("SQL query must reference at least one known table");
        }
    }

    private List<Map<String, Object>> executeFlux(String query) {
        QueryApi queryApi = influxDBClient.getQueryApi();
        List<Map<String, Object>> rows = new ArrayList<>();
        try {
            List<FluxTable> tables = queryApi.query(query, influxOrg);
            for (FluxTable table : tables) {
                for (FluxRecord record : table.getRecords()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    Instant time = record.getTime();
                    if (time != null) row.put("time", time.toString());
                    record.getValues().forEach((k, v) -> {
                        if (v == null) return;
                        switch (k) {
                            case "_value" -> row.put("value", v);
                            case "_field" -> row.put("field", v);
                            case "_measurement" -> row.put("measurement", v);
                            default -> { if (!k.startsWith("_")) row.put(k, v); }
                        }
                    });
                    rows.add(row);
                    if (rows.size() >= MAX_FLUX_ROWS) break;
                }
                if (rows.size() >= MAX_FLUX_ROWS) break;
            }
        } catch (Exception e) {
            log.error("Flux execution failed: {}", query, e);
            throw new RuntimeException("Flux query failed: " + e.getMessage(), e);
        }
        return rows;
    }

    private List<Map<String, Object>> executeSql(String query) {
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(query);
            return rows.size() > MAX_SQL_ROWS ? rows.subList(0, MAX_SQL_ROWS) : rows;
        } catch (Exception e) {
            log.error("SQL execution failed: {}", query, e);
            throw new RuntimeException("SQL query failed: " + e.getMessage(), e);
        }
    }
}
