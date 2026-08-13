package com.example.backend.can.service;

import com.example.backend.can.config.CatalogProperties;
import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.File;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Slf4j
public class CatalogLoaderService {

    private final CatalogProperties catalogProperties;

    /**
     * msgName -> (signalName -> valid values). Keyed per message so two buses can
     * define the same signal name with different enums without one silently
     * overwriting the other (the old flat signalName keying had that bug).
     */
    @Getter
    private final Map<String, Map<String, Set<Integer>>> messageSignalValidValues = new HashMap<>();

    @Getter
    private final Map<String, Long> messageCycleTimes = new HashMap<>();

    /** msgName -> owning Bus name (e.g. "ADAS_CAN") — used to seed subsystem mappings. */
    @Getter
    private final Map<String, String> messageSubsystems = new HashMap<>();

    /** filename -> msgName -> cycle ms — for session-scoped (per-car) lookups. */
    @Getter
    private final Map<String, Map<String, Long>> cycleTimesByFile = new HashMap<>();

    /** filename -> msgName -> signalName -> valid values — for session-scoped lookups. */
    @Getter
    private final Map<String, Map<String, Map<String, Set<Integer>>>> validValuesByFile = new HashMap<>();

    @PostConstruct
    public synchronized void load() {
        String path = catalogProperties.getPath();
        if (path == null || path.isBlank()) {
            log.warn("catalog.path is not configured");
            return;
        }
        File catalogDir = new File(path);
        if (!catalogDir.exists() || !catalogDir.isDirectory()) {
            log.warn("Catalog directory not found: {}", catalogProperties.getPath());
            return;
        }
        File[] xmlFiles = catalogDir.listFiles((dir, name) -> name.endsWith(".xml"));
        if (xmlFiles == null) {
            return;
        }

        // Full rebuild — without this, entries from a deleted/replaced catalog
        // survive every reload and keep influencing integrity analysis.
        messageSignalValidValues.clear();
        messageCycleTimes.clear();
        messageSubsystems.clear();
        cycleTimesByFile.clear();
        validValuesByFile.clear();

        for (File xmlFile : xmlFiles) {
            try {
                if (parseXml(xmlFile)) {
                    log.info("Loaded catalog: {}", xmlFile.getName());
                }
            } catch (Exception e) {
                log.error("Failed to parse catalog {}: {}", xmlFile.getName(), e.getMessage());
            }
        }
        log.info("Catalog loaded: {} signals across {} messages, {} cyclic messages",
                countSignals(), messageSignalValidValues.size(), messageCycleTimes.size());
    }

    /** Total number of enum-bearing signals across all messages. */
    public int countSignals() {
        return messageSignalValidValues.values().stream().mapToInt(Map::size).sum();
    }

    /**
     * Cycle time for a message, restricted to the given catalog files.
     * Null/empty scope = merged view of all catalogs (legacy behaviour).
     */
    public Long getCycleTime(String msgName, Set<String> catalogScope) {
        if (catalogScope == null || catalogScope.isEmpty()) {
            return messageCycleTimes.get(msgName);
        }
        for (String file : catalogScope) {
            Map<String, Long> byMsg = cycleTimesByFile.get(file);
            if (byMsg != null) {
                Long cycle = byMsg.get(msgName);
                if (cycle != null) {
                    return cycle;
                }
            }
        }
        return null;
    }

    /**
     * Signal valid-value sets for a message, restricted to the given catalog files.
     * Null/empty scope = merged view; a message outside the scope yields an empty
     * map, so out-of-scope traffic is never judged against another car's enums.
     */
    public Map<String, Set<Integer>> getValidValues(String msgName, Set<String> catalogScope) {
        if (catalogScope == null || catalogScope.isEmpty()) {
            return messageSignalValidValues.getOrDefault(msgName, Map.of());
        }
        for (String file : catalogScope) {
            Map<String, Map<String, Set<Integer>>> byMsg = validValuesByFile.get(file);
            if (byMsg != null) {
                Map<String, Set<Integer>> vals = byMsg.get(msgName);
                if (vals != null) {
                    return vals;
                }
            }
        }
        return Map.of();
    }

    /** @return {@code false} when the file is malformed or unreadable (already logged). */
    private boolean parseXml(File xmlFile) {
        org.w3c.dom.Document doc;
        try {
            doc = SafeXmlParserFactory.newSafeInstance()
                    .newDocumentBuilder()
                    .parse(xmlFile);
        } catch (org.xml.sax.SAXException e) {
            log.error("XML parse error in {}: {} — skipping file", xmlFile.getAbsolutePath(), e.getMessage());
            return false;
        } catch (java.io.IOException e) {
            log.error("Cannot read XML file {}: {} — skipping file", xmlFile.getAbsolutePath(), e.getMessage());
            return false;
        } catch (javax.xml.parsers.ParserConfigurationException e) {
            log.error("Cannot configure XML parser for {}: {} — skipping file", xmlFile.getAbsolutePath(), e.getMessage());
            return false;
        }

        doc.getDocumentElement().normalize();

        // Root element is <Bus Name="ADAS_CAN"> — the Bus name is the subsystem.
        String busName = doc.getDocumentElement().getAttribute("Name");

        // Note: XML uses "massage" (typo for "message")
        NodeList massages = doc.getElementsByTagName("massage");

        for (int i = 0; i < massages.getLength(); i++) {
            Element massage = (Element) massages.item(i);
            String msgName = massage.getAttribute("name");

            if (!msgName.isEmpty() && busName != null && !busName.isEmpty()) {
                messageSubsystems.put(msgName, busName);
            }

            // Parse cyclic timing
            NodeList cyclicList = massage.getElementsByTagName("Cyclic");
            if (cyclicList.getLength() > 0) {
                Element cyclic = (Element) cyclicList.item(0);
                String statusText = getTextContent(cyclic, "status").trim().toLowerCase();
                if ("true".equals(statusText)) {
                    String cycleText = getTextContent(cyclic, "cycle").trim();
                    if (!cycleText.isEmpty()) {
                        try {
                            long cycle = Long.parseLong(cycleText);
                            messageCycleTimes.put(msgName, cycle);
                            cycleTimesByFile
                                    .computeIfAbsent(xmlFile.getName(), k -> new HashMap<>())
                                    .put(msgName, cycle);
                        } catch (NumberFormatException e) {
                            log.warn("Invalid cycle value for {}: {}", msgName, cycleText);
                        }
                    }
                }
            }

            // Parse signals and their valid values
            NodeList signals = massage.getElementsByTagName("Signal");
            Map<String, Set<Integer>> msgSignals =
                    messageSignalValidValues.computeIfAbsent(msgName, k -> new HashMap<>());
            for (int j = 0; j < signals.getLength(); j++) {
                Element signal = (Element) signals.item(j);
                String signalName = getTextContent(signal, "signal_name").trim();
                if (signalName.isEmpty()) {
                    continue;
                }

                Set<Integer> validValues = new HashSet<>();
                NodeList valuesList = signal.getElementsByTagName("values");
                for (int k = 0; k < valuesList.getLength(); k++) {
                    Element valuesElem = (Element) valuesList.item(k);
                    // All <value> children — supports car_can (one per <values>) and powertrain (many in one <values>)
                    NodeList valueNodes = valuesElem.getElementsByTagName("value");
                    for (int vi = 0; vi < valueNodes.getLength(); vi++) {
                        Node vn = valueNodes.item(vi);
                        String valueText = vn.getTextContent() != null ? vn.getTextContent().trim() : "";
                        if (valueText.isEmpty() || valueText.contains("...")
                                || valueText.contains("E")) {
                            continue;
                        }
                        try {
                            validValues.add(Integer.parseInt(valueText));
                        } catch (NumberFormatException ignored) {
                            // skip non-integer values
                        }
                    }
                }
                if (!validValues.isEmpty()) {
                    validValuesByFile
                            .computeIfAbsent(xmlFile.getName(), k -> new HashMap<>())
                            .computeIfAbsent(msgName, k -> new HashMap<>())
                            .put(signalName, validValues);
                    Set<Integer> previous = msgSignals.put(signalName, validValues);
                    if (previous != null && !previous.equals(validValues)) {
                        log.warn("Signal {} in message {} redefined with a different valid set "
                                        + "({} -> {}) — check catalogs for duplicate definitions",
                                signalName, msgName, previous, validValues);
                    }
                }
            }
        }
        return true;
    }

    private String getTextContent(Element parent, String tagName) {
        NodeList list = parent.getElementsByTagName(tagName);
        if (list.getLength() == 0) {
            return "";
        }
        Node node = list.item(0);
        return node.getTextContent() != null ? node.getTextContent() : "";
    }
}
