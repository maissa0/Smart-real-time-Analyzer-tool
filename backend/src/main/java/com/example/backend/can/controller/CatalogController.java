package com.example.backend.can.controller;

import com.example.backend.can.dto.CatalogDetailDto;
import com.example.backend.can.dto.CatalogReloadResult;
import com.example.backend.can.dto.CatalogSourceDto;
import com.example.backend.can.dto.CatalogSummaryDto;
import com.example.backend.can.dto.CatalogUploadResult;
import com.example.backend.can.service.CatalogEditService;
import com.example.backend.can.service.CatalogService;
import com.example.backend.exception.SafeErrorMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/catalogs")
@RequiredArgsConstructor
@Slf4j
public class CatalogController {

    private final CatalogService catalogService;
    private final CatalogEditService catalogEditService;

    @PreAuthorize("hasAuthority('catalog:read') or hasRole('ADMIN')")
    @GetMapping
    public ResponseEntity<List<CatalogSummaryDto>> listCatalogs() {
        return ResponseEntity.ok(catalogService.listCatalogs());
    }

    @PreAuthorize("hasAuthority('catalog:read') or hasRole('ADMIN')")
    @GetMapping("/{filename}")
    public ResponseEntity<CatalogDetailDto> getCatalog(
            @PathVariable String filename) {
        if (!isSafeXmlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        return catalogService.getCatalogDetail(filename)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PreAuthorize("hasAuthority('catalog:read') or hasRole('ADMIN')")
    @GetMapping("/{filename}/source")
    public ResponseEntity<?> getCatalogSource(@PathVariable String filename) {
        if (!isSafeXmlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        try {
            String xml = catalogEditService.readSource(filename);
            return ResponseEntity.ok(new CatalogSourceDto(filename, xml));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Failed to read catalog source {}: {}", filename, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to read catalog source")));
        }
    }

    @PreAuthorize("hasAuthority('catalog:write') or hasRole('ADMIN')")
    @PutMapping("/{filename}/source")
    public ResponseEntity<?> saveCatalogSource(
            @PathVariable String filename,
            @RequestBody CatalogSourceDto body) {
        if (!isSafeXmlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        if (body == null || body.xml() == null || body.xml().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "XML content is required"));
        }
        try {
            catalogEditService.saveSource(filename, body.xml());
            return ResponseEntity.ok(Map.of("filename", filename, "status", "saved"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to save catalog source {}: {}", filename, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to save catalog source")));
        }
    }

    @PreAuthorize("hasAuthority('catalog:write') or hasRole('ADMIN')")
    @PutMapping("/{filename}")
    public ResponseEntity<?> saveCatalogStructured(
            @PathVariable String filename,
            @RequestBody CatalogDetailDto body) {
        if (!isSafeXmlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        if (body == null || body.messages() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Catalog messages are required"));
        }
        try {
            CatalogDetailDto saved = catalogEditService.saveStructured(filename, body);
            return ResponseEntity.ok(saved);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to save catalog {}: {}", filename, e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to save catalog")));
        }
    }

    @PreAuthorize("hasAuthority('catalog:write') or hasRole('ADMIN')")
    @PostMapping("/upload")
    public ResponseEntity<?> uploadCatalog(
            @RequestParam("file") MultipartFile file) {
        String originalName = file.getOriginalFilename();
        if (originalName == null || !isSafeXmlFilename(originalName)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Only .xml files with a safe filename are accepted"));
        }
        try {
            CatalogUploadResult result = catalogService.uploadCatalog(file);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Failed to upload catalog: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to upload catalog")));
        }
    }

    @PreAuthorize("hasAuthority('catalog:write') or hasRole('ADMIN')")
    @DeleteMapping("/{filename}")
    public ResponseEntity<?> deleteCatalog(
            @PathVariable String filename) {
        if (!isSafeXmlFilename(filename)) {
            return ResponseEntity.badRequest().build();
        }
        try {
            boolean deleted = catalogService.deleteCatalog(filename);
            if (!deleted) return ResponseEntity.notFound().build();
            return ResponseEntity.ok(Map.of("filename", filename, "status", "deleted"));
        } catch (Exception e) {
            log.error("Failed to delete catalog: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to delete catalog")));
        }
    }

    @PreAuthorize("hasAuthority('catalog:write') or hasRole('ADMIN')")
    @PostMapping("/reload")
    public ResponseEntity<?> reloadCatalogs() {
        try {
            CatalogReloadResult result = catalogService.reloadCatalogs();
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Failed to reload catalogs: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", SafeErrorMessage.of(e, "Failed to reload catalogs")));
        }
    }

    /** Rejects anything but a bare ".xml" filename — no path traversal or directory separators. */
    private boolean isSafeXmlFilename(String filename) {
        return filename.endsWith(".xml")
                && !filename.contains("..")
                && !filename.contains("/")
                && !filename.contains("\\");
    }
}
