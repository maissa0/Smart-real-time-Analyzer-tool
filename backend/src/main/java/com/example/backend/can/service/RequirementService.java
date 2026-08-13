package com.example.backend.can.service;

import com.example.backend.can.dto.CatalogDetailDto;
import com.example.backend.can.dto.RequirementDtos.CreateRequest;
import com.example.backend.can.dto.RequirementDtos.MetaUpdateDto;
import com.example.backend.can.dto.RequirementDtos.RuleEditDto;
import com.example.backend.can.dto.RequirementDtos.SignalContextDto;
import com.example.backend.can.dto.RequirementDtos.SignalOptionDto;
import com.example.backend.can.dto.RequirementDtos.SummaryDto;
import com.example.backend.can.entity.CarEntity;
import com.example.backend.can.entity.RequirementSetEntity;
import com.example.backend.can.repository.CarRepository;
import com.example.backend.can.repository.RequirementSetRepository;
import com.example.backend.can.requirements.RequirementModel.RequirementFile;
import com.example.backend.can.requirements.RequirementParser;
import com.example.backend.can.requirements.RequirementYamlEditor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Requirement-set file management: list, upload, source round-trip, delete.
 * Files are fully dynamic user uploads assigned per car; every write is
 * validate -> backup -> write -> registry sync (CatalogEditService pattern).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RequirementService {

    private static final DateTimeFormatter BACKUP_TS =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final long MAX_UPLOAD_BYTES = 1_000_000; // rule files are small text

    private final RequirementLoaderService loader;
    private final RequirementSetRepository requirementSetRepository;
    private final CarRepository carRepository;
    private final CatalogService catalogService;

    /** Listing of every YAML file in the requirements directory. */
    public List<SummaryDto> listSets() {
        List<SummaryDto> out = new ArrayList<>();
        for (String filename : loader.listFilenames()) {
            Optional<RequirementFile> parsed = loader.get(filename);
            if (parsed.isPresent()) {
                RequirementFile f = parsed.get();
                out.add(new SummaryDto(filename, f.name(), f.version(),
                        f.ruleCount(), f.draftCount(), true));
            } else {
                // Present on disk but unparseable — listed so the user can fix it.
                out.add(new SummaryDto(filename, filename, null, 0, 0, false));
            }
        }
        return out;
    }

    /** Parsed detail of one file. */
    public Optional<RequirementFile> getParsed(String filename) {
        return loader.get(filename);
    }

    /** Raw YAML text of one file. */
    public String readSource(String filename) throws IOException {
        Path file = loader.requirementFile(filename);
        if (!Files.exists(file)) {
            throw new IllegalArgumentException("Requirement set not found: " + filename);
        }
        return Files.readString(file, StandardCharsets.UTF_8);
    }

    /** Validate + save user-edited YAML over an existing file (with backup). */
    @Transactional
    public synchronized SummaryDto saveSource(String filename, String yaml) throws IOException {
        Path file = loader.requirementFile(filename);
        if (!Files.exists(file)) {
            throw new IllegalArgumentException("Requirement set not found: " + filename);
        }
        RequirementFile parsed = RequirementParser.parse(filename, yaml);

        backup(file);
        Files.writeString(file, yaml, StandardCharsets.UTF_8);
        loader.evict(filename);
        syncRegistry(parsed);
        log.info("Requirement set saved: {} ({} rules)", filename, parsed.ruleCount());
        return new SummaryDto(filename, parsed.name(), parsed.version(),
                parsed.ruleCount(), parsed.draftCount(), true);
    }

    // ── Structured mutations (Phase A, docs/REQUIREMENTS_AUTHORING_PLAN.md) ──
    // Each one: parse -> modify -> re-serialize -> same backup + write + reload
    // path as saveSource. The re-parse of the mutated YAML rejects invalid
    // input with the parser's precise errors before anything touches disk.

    /** Append one rule to an existing file. */
    @Transactional
    public synchronized SummaryDto addRule(String filename, RuleEditDto rule) throws IOException {
        return mutate(filename, yaml -> RequirementYamlEditor.addRule(yaml, rule));
    }

    /**
     * Append several rules in one validate -> backup -> write cycle (Phase D:
     * "Save accepted (K)" from the bulk review screen writes the file once).
     */
    @Transactional
    public synchronized SummaryDto addRules(String filename, List<RuleEditDto> rules)
            throws IOException {
        if (rules == null || rules.isEmpty()) {
            throw new IllegalArgumentException("No rules to add");
        }
        return mutate(filename, yaml -> {
            String out = yaml;
            for (RuleEditDto rule : rules) {
                out = RequirementYamlEditor.addRule(out, rule);
            }
            return out;
        });
    }

    /** Replace the rule with id {@code ruleId} (the edit may rename it). */
    @Transactional
    public synchronized SummaryDto updateRule(String filename, String ruleId, RuleEditDto rule)
            throws IOException {
        return mutate(filename, yaml -> RequirementYamlEditor.updateRule(yaml, ruleId, rule));
    }

    /** Remove the rule with id {@code ruleId}. */
    @Transactional
    public synchronized SummaryDto deleteRule(String filename, String ruleId) throws IOException {
        return mutate(filename, yaml -> RequirementYamlEditor.deleteRule(yaml, ruleId));
    }

    /** Replace the meta section (name, version, signal_map, derived_signals). */
    @Transactional
    public synchronized SummaryDto updateMeta(String filename, MetaUpdateDto meta) throws IOException {
        return mutate(filename, yaml -> RequirementYamlEditor.updateMeta(yaml, meta));
    }

    /**
     * Create a new, empty (but valid) requirement file; when {@code carUid} is
     * given the file is assigned to that car in the same transaction so the
     * builder page opens with the car's signal context already in scope.
     */
    @Transactional
    public synchronized SummaryDto createFile(CreateRequest request) throws IOException {
        String filename = request.filename();
        Path file = loader.requirementFile(filename);
        if (Files.exists(file)) {
            throw new IllegalArgumentException(
                    "A requirement set named " + filename + " already exists");
        }
        String displayName = request.name() == null || request.name().isBlank()
                ? filename : request.name().trim();
        String yaml = RequirementYamlEditor.newFile(displayName);
        RequirementFile parsed = RequirementParser.parse(filename, yaml);

        Files.createDirectories(file.getParent());
        Files.writeString(file, yaml, StandardCharsets.UTF_8);
        loader.evict(filename);
        RequirementSetEntity entity = syncRegistry(parsed);

        if (request.carUid() != null && !request.carUid().isBlank()) {
            CarEntity car = carRepository.findByCarUidWithRequirements(request.carUid())
                    .orElseThrow(() -> new IllegalArgumentException(
                            "Unknown car: " + request.carUid()));
            car.getRequirementSets().add(entity);
            carRepository.save(car);
        }
        log.info("Requirement set created: {} (car: {})", filename, request.carUid());
        return new SummaryDto(filename, parsed.name(), parsed.version(),
                parsed.ruleCount(), parsed.draftCount(), true);
    }

    /**
     * Signals available to a requirement file's rules: the union of catalog
     * signals (name + enum labels + owning message) of every active car the
     * file is assigned to. A non-null {@code carUid} scopes to that car only
     * (car-page builder); a file assigned to no car gets all catalogs with
     * {@code scoped=false} so the UI can show a notice.
     */
    public SignalContextDto signalContext(String filename, String carUid) {
        List<String> catalogFiles;
        boolean scoped;
        if (carUid != null && !carUid.isBlank()) {
            catalogFiles = carRepository.findCatalogFilenamesByCarUid(carUid);
            scoped = true;
        } else if (carRepository.countCarsByRequirementFilename(filename) > 0) {
            catalogFiles = carRepository.findCatalogFilenamesByRequirementFilename(filename);
            scoped = true;
        } else {
            catalogFiles = catalogService.listCatalogs().stream()
                    .map(c -> c.filename())
                    .toList();
            scoped = false;
        }
        List<SignalOptionDto> signals = new ArrayList<>();
        for (String catalogFile : catalogFiles) {
            Optional<CatalogDetailDto> detail = catalogService.getCatalogDetail(catalogFile);
            if (detail.isEmpty()) {
                continue;
            }
            for (var message : detail.get().messages()) {
                for (var sig : message.signals()) {
                    if (sig.name() == null || sig.name().isBlank()) {
                        continue;
                    }
                    List<String> labels = sig.values().stream()
                            .map(v -> v.label())
                            .filter(l -> l != null && !l.isBlank())
                            .toList();
                    signals.add(new SignalOptionDto(
                            sig.name(), message.name(), catalogFile, labels));
                }
            }
        }
        return new SignalContextDto(filename, scoped, signals);
    }

    /** Shared read -> transform -> validate -> backup -> write path. */
    private SummaryDto mutate(String filename, java.util.function.UnaryOperator<String> transform)
            throws IOException {
        Path file = loader.requirementFile(filename);
        if (!Files.exists(file)) {
            throw new IllegalArgumentException("Requirement set not found: " + filename);
        }
        String current = Files.readString(file, StandardCharsets.UTF_8);
        String updated = transform.apply(current);
        RequirementFile parsed = RequirementParser.parse(filename, updated);

        backup(file);
        Files.writeString(file, updated, StandardCharsets.UTF_8);
        loader.evict(filename);
        syncRegistry(parsed);
        log.info("Requirement set mutated: {} ({} rules)", filename, parsed.ruleCount());
        return new SummaryDto(filename, parsed.name(), parsed.version(),
                parsed.ruleCount(), parsed.draftCount(), true);
    }

    /** Validate + store a newly uploaded requirement file. */
    @Transactional
    public synchronized SummaryDto upload(MultipartFile upload) throws IOException {
        String filename = upload.getOriginalFilename();
        if (filename == null) {
            throw new IllegalArgumentException("Upload has no filename");
        }
        if (upload.getSize() > MAX_UPLOAD_BYTES) {
            throw new IllegalArgumentException("File too large (max 1 MB)");
        }
        Path file = loader.requirementFile(filename);
        if (Files.exists(file)) {
            throw new IllegalArgumentException(
                    "A requirement set named " + filename + " already exists — edit or delete it first");
        }
        String yaml = new String(upload.getBytes(), StandardCharsets.UTF_8);
        RequirementFile parsed = RequirementParser.parse(filename, yaml);

        Files.createDirectories(file.getParent());
        Files.writeString(file, yaml, StandardCharsets.UTF_8);
        loader.evict(filename);
        syncRegistry(parsed);
        log.info("Requirement set uploaded: {} ({} rules)", filename, parsed.ruleCount());
        return new SummaryDto(filename, parsed.name(), parsed.version(),
                parsed.ruleCount(), parsed.draftCount(), true);
    }

    /**
     * Delete a requirement file and its registry row. Car assignments cascade
     * via the join-table FK. The file itself is backed up first so an
     * accidental delete is recoverable from disk.
     */
    @Transactional
    public synchronized void delete(String filename) throws IOException {
        Path file = loader.requirementFile(filename);
        if (!Files.exists(file)) {
            throw new IllegalArgumentException("Requirement set not found: " + filename);
        }
        backup(file);
        Files.delete(file);
        loader.evict(filename);
        requirementSetRepository.findByFilename(filename)
                .ifPresent(requirementSetRepository::delete);
        log.info("Requirement set deleted: {}", filename);
    }

    /** Re-scan the directory and re-sync registry rows for every parseable file. */
    @Transactional
    public synchronized List<SummaryDto> reload() {
        loader.evictAll();
        for (String filename : loader.listFilenames()) {
            loader.get(filename).ifPresent(parsed -> syncRegistry(parsed));
        }
        return listSets();
    }

    /**
     * Registry row for a filename, creating it from the on-disk file when the
     * DB row is missing (e.g. files present before the registry table existed).
     * Empty when the file is absent or unparseable. Lets the car-assignment
     * path self-heal instead of rejecting a file that is valid on disk.
     */
    @Transactional
    public Optional<RequirementSetEntity> ensureRegistered(String filename) {
        Optional<RequirementSetEntity> existing = requirementSetRepository.findByFilename(filename);
        if (existing.isPresent()) {
            return existing;
        }
        return loader.get(filename).map(this::syncRegistry);
    }

    /** Upsert the DB registry row from a parsed file. */
    private RequirementSetEntity syncRegistry(RequirementFile parsed) {
        RequirementSetEntity entity = requirementSetRepository
                .findByFilename(parsed.filename())
                .orElseGet(() -> RequirementSetEntity.builder()
                        .filename(parsed.filename())
                        .build());
        entity.setName(parsed.name());
        entity.setVersion(parsed.version());
        entity.setRuleCount((int) parsed.ruleCount());
        entity.setIsActive(true);
        return requirementSetRepository.save(entity);
    }

    private void backup(Path file) throws IOException {
        Path backup = file.resolveSibling(
                file.getFileName() + ".bak-" + LocalDateTime.now().format(BACKUP_TS));
        // Timestamps are second-precise: rapid successive edits (the structured
        // editor saves per rule) may share one backup name — keep the latest.
        Files.copy(file, backup, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        log.info("Requirement backup written: {}", backup.getFileName());
    }
}
