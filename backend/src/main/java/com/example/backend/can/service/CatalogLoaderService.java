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

import javax.xml.parsers.DocumentBuilderFactory;
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

    @Getter
    private final Map<String, Set<Integer>> signalValidValues = new HashMap<>();

    @Getter
    private final Map<String, Long> messageCycleTimes = new HashMap<>();

    @PostConstruct
    public void load() {
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

        for (File xmlFile : xmlFiles) {
            try {
                if (parseXml(xmlFile)) {
                    log.info("Loaded catalog: {}", xmlFile.getName());
                }
            } catch (Exception e) {
                log.error("Failed to parse catalog {}: {}", xmlFile.getName(), e.getMessage());
            }
        }
        log.info("Catalog loaded: {} signals, {} cyclic messages",
                signalValidValues.size(), messageCycleTimes.size());
    }

    /** @return {@code false} when the file is malformed or unreadable (already logged). */
    private boolean parseXml(File xmlFile) {
        org.w3c.dom.Document doc;
        try {
            doc = DocumentBuilderFactory.newInstance()
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

        // Note: XML uses "massage" (typo for "message")
        NodeList massages = doc.getElementsByTagName("massage");

        for (int i = 0; i < massages.getLength(); i++) {
            Element massage = (Element) massages.item(i);
            String msgName = massage.getAttribute("name");

            // Parse cyclic timing
            NodeList cyclicList = massage.getElementsByTagName("Cyclic");
            if (cyclicList.getLength() > 0) {
                Element cyclic = (Element) cyclicList.item(0);
                String statusText = getTextContent(cyclic, "status").trim().toLowerCase();
                if ("true".equals(statusText)) {
                    String cycleText = getTextContent(cyclic, "cycle").trim();
                    if (!cycleText.isEmpty()) {
                        try {
                            messageCycleTimes.put(msgName, Long.parseLong(cycleText));
                        } catch (NumberFormatException e) {
                            log.warn("Invalid cycle value for {}: {}", msgName, cycleText);
                        }
                    }
                }
            }

            // Parse signals and their valid values
            NodeList signals = massage.getElementsByTagName("Signal");
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
                    signalValidValues.put(signalName, validValues);
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
