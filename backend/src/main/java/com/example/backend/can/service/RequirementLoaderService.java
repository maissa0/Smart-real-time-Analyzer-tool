package com.example.backend.can.service;

import com.example.backend.can.config.RequirementProperties;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.example.backend.can.requirements.RequirementParser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Parses and caches requirement-set YAML files from the requirements directory.
 * Cache entries are keyed by filename and invalidated by file mtime, so edits
 * saved through the editor (or dropped on disk) are picked up without restart —
 * same pattern as the decoder's catalog hot reload.
 *
 * Files are fully dynamic user uploads: nothing here knows any specific rule
 * ids or signal names. A file that fails to parse is skipped (logged, and
 * reported invalid in listings) — it never breaks the others.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RequirementLoaderService {

    private final RequirementProperties requirementProperties;

    private record CacheEntry(long mtime, RequirementFile parsed) {}

    private final ConcurrentHashMap<String, CacheEntry> cache = new ConcurrentHashMap<>();

    /** All YAML filenames present in the requirements directory (sorted). */
    public List<String> listFilenames() {
        File[] files = yamlFiles();
        List<String> names = new ArrayList<>();
        for (File f : files) {
            names.add(f.getName());
        }
        names.sort(String.CASE_INSENSITIVE_ORDER);
        return names;
    }

    /** Parsed form of one file; empty when missing or invalid (already logged). */
    public Optional<RequirementFile> get(String filename) {
        Path file = requirementFile(filename);
        if (!Files.exists(file)) {
            cache.remove(filename);
            return Optional.empty();
        }
        long mtime = file.toFile().lastModified();
        CacheEntry cached = cache.get(filename);
        if (cached != null && cached.mtime() == mtime) {
            return Optional.of(cached.parsed());
        }
        try {
            String yaml = Files.readString(file, StandardCharsets.UTF_8);
            RequirementFile parsed = RequirementParser.parse(filename, yaml);
            cache.put(filename, new CacheEntry(mtime, parsed));
            return Optional.of(parsed);
        } catch (IOException e) {
            log.error("Cannot read requirement file {}: {}", filename, e.getMessage());
            return Optional.empty();
        } catch (IllegalArgumentException e) {
            log.warn("Requirement file {} is invalid: {}", filename, e.getMessage());
            cache.remove(filename);
            return Optional.empty();
        }
    }

    /**
     * Parsed rule sets for the given filenames — the per-session snapshot the
     * Phase-2 engine arms at session start. Missing/invalid files are skipped.
     */
    public Map<String, RequirementFile> snapshotFor(Collection<String> filenames) {
        Map<String, RequirementFile> out = new LinkedHashMap<>();
        for (String filename : filenames) {
            get(filename).ifPresent(parsed -> out.put(filename, parsed));
        }
        return Map.copyOf(out);
    }

    /** Drop a cache entry (after save/delete) so the next read re-parses. */
    public void evict(String filename) {
        cache.remove(filename);
    }

    /** Drop the whole cache (explicit reload endpoint). */
    public void evictAll() {
        cache.clear();
    }

    /** Absolute path of a requirement file inside the configured directory. */
    public Path requirementFile(String filename) {
        return Path.of(requirementProperties.getPath(), filename);
    }

    private File[] yamlFiles() {
        String path = requirementProperties.getPath();
        if (path == null || path.isBlank()) {
            log.warn("requirements.path is not configured");
            return new File[0];
        }
        File dir = new File(path);
        if (!dir.exists() || !dir.isDirectory()) {
            return new File[0];
        }
        File[] files = dir.listFiles((d, name) -> {
            String lower = name.toLowerCase();
            return lower.endsWith(".yaml") || lower.endsWith(".yml");
        });
        return files != null ? files : new File[0];
    }
}
