package com.example.backend.can.service;

import com.example.backend.can.config.CatalogProperties;
import com.example.backend.can.dto.CatalogDetailDto;
import com.example.backend.can.dto.CatalogReloadResult;
import com.example.backend.can.dto.CatalogSummaryDto;
import com.example.backend.can.dto.CatalogUploadResult;
import com.example.backend.can.dto.MessageDto;
import com.example.backend.can.dto.SignalDto;
import com.example.backend.can.dto.SignalValueDto;
import com.example.backend.can.entity.EcuCatalogEntity;
import com.example.backend.can.repository.EcuCatalogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class CatalogService {

    private final CatalogProperties catalogProperties;
    private final CatalogLoaderService catalogLoaderService;
    private final EcuCatalogRepository ecuCatalogRepository;

    public List<CatalogSummaryDto> listCatalogs() {
        File dir = new File(catalogProperties.getPath());
        if (!dir.exists() || !dir.isDirectory()) return Collections.emptyList();
        File[] xmlFiles = dir.listFiles((d, name) -> name.endsWith(".xml"));
        if (xmlFiles == null) return Collections.emptyList();

        List<CatalogSummaryDto> result = new ArrayList<>();
        for (File f : xmlFiles) {
            result.add(parseSummary(f));
        }
        result.sort(Comparator.comparing(CatalogSummaryDto::filename));
        return result;
    }

    public Optional<CatalogDetailDto> getCatalogDetail(String filename) {
        File f = new File(catalogProperties.getPath(), filename);
        if (!f.exists()) return Optional.empty();
        return Optional.of(parseDetail(f));
    }

    /**
     * Saves the uploaded XML to disk, triggers a catalog reload, and upserts the DB record.
     * Caller must have already validated that the filename is non-null and ends with ".xml".
     */
    public CatalogUploadResult uploadCatalog(MultipartFile file) throws IOException {
        String originalName = file.getOriginalFilename();
        Path dest = Paths.get(catalogProperties.getPath(), originalName);
        Files.copy(file.getInputStream(), dest, StandardCopyOption.REPLACE_EXISTING);
        catalogLoaderService.load();
        syncToDb(originalName, dest.toFile());
        log.info("Catalog uploaded and reloaded: {}", originalName);
        return new CatalogUploadResult(true, originalName, "uploaded");
    }

    /**
     * Deletes the catalog file, reloads in-memory catalog, and removes the DB record.
     * Returns false when the file does not exist so the controller can map to 404.
     */
    public boolean deleteCatalog(String filename) throws IOException {
        File f = new File(catalogProperties.getPath(), filename);
        if (!f.exists()) return false;
        Files.delete(f.toPath());
        catalogLoaderService.load();
        ecuCatalogRepository.findByFilename(filename)
                .ifPresent(ecuCatalogRepository::delete);
        log.info("Catalog deleted and reloaded: {}", filename);
        return true;
    }

    public CatalogReloadResult reloadCatalogs() {
        catalogLoaderService.load();
        log.info("Catalogs reloaded via API");
        return new CatalogReloadResult(
                true,
                catalogLoaderService.countSignals(),
                catalogLoaderService.getMessageCycleTimes().size()
        );
    }

    /**
     * Scans the catalog directory and upserts a DB row for every XML file that has no record yet.
     * Called once at startup by AppStartupRunner — idempotent.
     */
    public void syncExistingCatalogs() {
        File dir = new File(catalogProperties.getPath());
        if (!dir.exists() || !dir.isDirectory()) return;
        File[] xmlFiles = dir.listFiles((d, name) -> name.endsWith(".xml"));
        if (xmlFiles == null) return;
        java.util.Set<String> known = new java.util.HashSet<>(ecuCatalogRepository.findAllFilenames());
        for (File f : xmlFiles) {
            if (!known.contains(f.getName())) {
                syncToDb(f.getName(), f);
                log.info("Auto-synced catalog to DB: {}", f.getName());
            }
        }
    }

    // ── Private XML helpers ───────────────────────────────────────────────────

    private CatalogSummaryDto parseSummary(File f) {
        String busName = "";
        int messageCount = 0;
        int signalCount = 0;
        try {
            org.w3c.dom.Document doc = SafeXmlParserFactory.newSafeInstance()
                    .newDocumentBuilder().parse(f);
            doc.getDocumentElement().normalize();
            NodeList buses = doc.getElementsByTagName("Bus");
            if (buses.getLength() > 0) {
                busName = ((Element) buses.item(0)).getAttribute("Name");
            }
            NodeList messages = doc.getElementsByTagName("massage");
            messageCount = messages.getLength();
            for (int i = 0; i < messages.getLength(); i++) {
                signalCount += ((Element) messages.item(i))
                        .getElementsByTagName("Signal").getLength();
            }
        } catch (Exception e) {
            log.warn("Could not parse summary for {}: {}", f.getName(), e.getMessage());
        }
        return new CatalogSummaryDto(
                f.getName(),
                busName,
                messageCount,
                signalCount,
                f.length(),
                LocalDate.ofInstant(Instant.ofEpochMilli(f.lastModified()), ZoneId.systemDefault()).toString()
        );
    }

    private CatalogDetailDto parseDetail(File f) {
        String busName = "";
        List<MessageDto> msgList = new ArrayList<>();
        try {
            org.w3c.dom.Document doc = SafeXmlParserFactory.newSafeInstance()
                    .newDocumentBuilder().parse(f);
            doc.getDocumentElement().normalize();
            NodeList buses = doc.getElementsByTagName("Bus");
            if (buses.getLength() > 0) {
                busName = ((Element) buses.item(0)).getAttribute("Name");
            }
            NodeList messages = doc.getElementsByTagName("massage");
            for (int i = 0; i < messages.getLength(); i++) {
                Element msg = (Element) messages.item(i);
                List<SignalDto> sigList = new ArrayList<>();
                // Signals live inside <Byte Num="n"> wrappers — walk them so each
                // signal carries its byte position for the bit-layout view.
                NodeList bytes = msg.getElementsByTagName("Byte");
                for (int b = 0; b < bytes.getLength(); b++) {
                    Element byteEl = (Element) bytes.item(b);
                    int byteNum = parseByteNum(byteEl);
                    NodeList signals = byteEl.getElementsByTagName("Signal");
                    for (int j = 0; j < signals.getLength(); j++) {
                        sigList.add(parseSignal((Element) signals.item(j), byteNum));
                    }
                }
                // Defensive fallback for signals not wrapped in <Byte>
                if (sigList.isEmpty()) {
                    NodeList signals = msg.getElementsByTagName("Signal");
                    for (int j = 0; j < signals.getLength(); j++) {
                        sigList.add(parseSignal((Element) signals.item(j), 0));
                    }
                }
                msgList.add(new MessageDto(
                        msg.getAttribute("id"),
                        msg.getAttribute("name"),
                        parseCycleMs(msg),
                        sigList));
            }
        } catch (Exception e) {
            log.warn("Could not parse detail for {}: {}", f.getName(), e.getMessage());
        }
        return new CatalogDetailDto(f.getName(), busName, msgList);
    }

    private SignalDto parseSignal(Element sig, int byteNum) {
        NodeList nameNodes = sig.getElementsByTagName("signal_name");
        String sigName = nameNodes.getLength() > 0
                ? nameNodes.item(0).getTextContent().trim() : "";
        String bit = sig.getAttribute("Bit");
        NodeList valuesNodes = sig.getElementsByTagName("values");
        List<SignalValueDto> valueList = new ArrayList<>();
        for (int k = 0; k < valuesNodes.getLength(); k++) {
            Element vals = (Element) valuesNodes.item(k);
            NodeList vNodes = vals.getElementsByTagName("value");
            NodeList nNodes = vals.getElementsByTagName("name");
            if (vNodes.getLength() > 1) {
                for (int vi = 0; vi < vNodes.getLength(); vi++) {
                    valueList.add(new SignalValueDto(
                            vNodes.item(vi).getTextContent().trim(),
                            vi < nNodes.getLength()
                                    ? nNodes.item(vi).getTextContent().trim() : ""));
                }
            } else {
                valueList.add(new SignalValueDto(
                        vNodes.getLength() > 0
                                ? vNodes.item(0).getTextContent().trim() : "",
                        nNodes.getLength() > 0
                                ? nNodes.item(0).getTextContent().trim() : ""));
            }
        }
        return new SignalDto(sigName, bit, byteNum, valueList);
    }

    /** Cycle time in ms from <Cyclic><status>true</status><cycle>N</cycle></Cyclic>, else null. */
    private Long parseCycleMs(Element msg) {
        NodeList cyclics = msg.getElementsByTagName("Cyclic");
        if (cyclics.getLength() == 0) return null;
        Element cyclic = (Element) cyclics.item(0);
        if (!"true".equalsIgnoreCase(childText(cyclic, "status"))) return null;
        String cycleText = childText(cyclic, "cycle");
        try {
            return cycleText.isEmpty() ? null : Long.parseLong(cycleText);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Byte index from <Num> child or Num attribute — mirrors xml_decoder.py. */
    private int parseByteNum(Element byteEl) {
        String numText = childText(byteEl, "Num");
        if (numText.isEmpty()) {
            numText = byteEl.getAttribute("Num").trim();
        }
        try {
            return numText.isEmpty() ? 0 : Integer.parseInt(numText);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private String childText(Element parent, String tag) {
        NodeList nl = parent.getElementsByTagName(tag);
        return nl.getLength() > 0 ? nl.item(0).getTextContent().trim() : "";
    }

    private void syncToDb(String filename, File xmlFile) {
        try {
            String busName = "";
            String name = filename.replace(".xml", "").replace("_", " ");
            try {
                org.w3c.dom.Document doc = SafeXmlParserFactory.newSafeInstance()
                        .newDocumentBuilder().parse(xmlFile);
                doc.getDocumentElement().normalize();
                NodeList buses = doc.getElementsByTagName("Bus");
                if (buses.getLength() > 0) {
                    busName = ((Element) buses.item(0)).getAttribute("Name");
                }
            } catch (Exception e) {
                log.warn("Could not parse bus name for DB sync: {}", e.getMessage());
            }
            final String resolvedBusName = busName;
            final String resolvedName = name;
            EcuCatalogEntity entity = ecuCatalogRepository
                    .findByFilename(filename)
                    .orElse(EcuCatalogEntity.builder().filename(filename).build());
            entity.setName(resolvedName);
            entity.setBusName(resolvedBusName.isEmpty() ? "Unknown" : resolvedBusName);
            entity.setIsActive(true);
            ecuCatalogRepository.save(entity);
            log.info("Catalog synced to DB: {}", filename);
        } catch (Exception e) {
            log.warn("Could not sync catalog to DB: {}", e.getMessage());
        }
    }
}
