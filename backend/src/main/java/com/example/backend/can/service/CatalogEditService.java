package com.example.backend.can.service;

import com.example.backend.can.config.CatalogProperties;
import com.example.backend.can.dto.CatalogDetailDto;
import com.example.backend.can.dto.MessageDto;
import com.example.backend.can.dto.SignalDto;
import com.example.backend.can.dto.SignalValueDto;
import com.example.backend.can.repository.EcuCatalogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Frontend catalog editing: raw XML source round-trip and structured
 * (message/signal/enum) editing via surgical DOM patching.
 *
 * Every save: validate -> backup previous file (.bak-timestamp, invisible to
 * the *.xml loaders) -> write -> reload the in-memory catalog -> sync DB row.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CatalogEditService {

    // '0' and 'x' both mean "bit not selected" — the Python decoder, maskOf and
    // the shipped catalog files (e.g. Bit="00001111") use them interchangeably.
    private static final Pattern BIT_PATTERN = Pattern.compile("^[x01]{8}$");
    private static final Pattern MSG_ID_PATTERN = Pattern.compile("^0[xX][0-9a-fA-F]{1,8}$");
    private static final Pattern ID_ATTR_PATTERN = Pattern.compile("id=\"([^\"]+)\"");
    private static final DateTimeFormatter BACKUP_TS =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final CatalogProperties catalogProperties;
    private final CatalogLoaderService catalogLoaderService;
    private final CatalogService catalogService;
    private final EcuCatalogRepository ecuCatalogRepository;

    // ── Raw source (Option A) ─────────────────────────────────────────────────

    /** Raw XML text of an existing catalog file. */
    public String readSource(String filename) throws IOException {
        Path file = catalogFile(filename);
        if (!Files.exists(file)) {
            throw new IllegalArgumentException("Catalog not found: " + filename);
        }
        return Files.readString(file, StandardCharsets.UTF_8);
    }

    /**
     * Replaces the catalog file with user-edited XML after validating that it
     * parses and passes the structural rules. Backs up the previous version.
     */
    public synchronized void saveSource(String filename, String xml) throws IOException {
        Path file = catalogFile(filename);
        if (!Files.exists(file)) {
            throw new IllegalArgumentException("Catalog not found: " + filename);
        }
        Document doc = parseXmlString(xml);
        validateDocument(doc, filename);

        backup(file);
        Files.writeString(file, xml, StandardCharsets.UTF_8);
        afterSave(filename, doc);
        log.info("Catalog source saved: {}", filename);
    }

    // ── Structured editing (Option B) ─────────────────────────────────────────

    /**
     * Applies a structured edit to the catalog file. Messages are matched by CAN
     * id: matched ones are patched in place (name, Cyclic, Byte/Signal tree
     * rebuilt) while unrelated children like sender/reciver/Event are preserved;
     * unmatched incoming messages are appended; DOM messages absent from the
     * payload are removed.
     */
    public synchronized CatalogDetailDto saveStructured(String filename, CatalogDetailDto detail)
            throws IOException {
        Path file = catalogFile(filename);
        if (!Files.exists(file)) {
            throw new IllegalArgumentException("Catalog not found: " + filename);
        }
        validateDetail(detail, filename);

        Document doc = parseXmlString(Files.readString(file, StandardCharsets.UTF_8));
        Element bus = firstElement(doc.getDocumentElement(), "Bus");
        if (bus == null) {
            throw new IllegalArgumentException("Catalog has no <Bus> element: " + filename);
        }
        if (detail.busName() != null && !detail.busName().isBlank()) {
            bus.setAttribute("Name", detail.busName().trim());
        }

        // Index existing <massage> elements by their CAN id
        Map<String, Element> existingById = new LinkedHashMap<>();
        NodeList massages = bus.getElementsByTagName("massage");
        for (int i = 0; i < massages.getLength(); i++) {
            Element m = (Element) massages.item(i);
            existingById.put(normalizeId(m.getAttribute("id")), m);
        }

        Set<String> incomingIds = new HashSet<>();
        for (MessageDto msg : detail.messages()) {
            String key = normalizeId(msg.id());
            incomingIds.add(key);
            Element target = existingById.get(key);
            if (target == null) {
                target = doc.createElement("massage");
                bus.appendChild(target);
            }
            patchMessage(doc, target, msg);
        }

        // Remove messages the user deleted
        for (Map.Entry<String, Element> entry : existingById.entrySet()) {
            if (!incomingIds.contains(entry.getKey())) {
                entry.getValue().getParentNode().removeChild(entry.getValue());
            }
        }

        String xml = serialize(doc);
        backup(file);
        Files.writeString(file, xml, StandardCharsets.UTF_8);
        afterSave(filename, doc);
        log.info("Catalog structured edit saved: {} ({} messages)", filename, detail.messages().size());

        return catalogService.getCatalogDetail(filename)
                .orElseThrow(() -> new IOException("Catalog unreadable after save: " + filename));
    }

    // ── Patch helpers ─────────────────────────────────────────────────────────

    /** Rebuild name, Cyclic and the Byte/Signal tree; keep every other child. */
    private void patchMessage(Document doc, Element msgEl, MessageDto msg) {
        msgEl.setAttribute("name", msg.name().trim());
        msgEl.setAttribute("id", msg.id().trim());

        removeChildren(msgEl, "Cyclic");
        Element cyclic = doc.createElement("Cyclic");
        Element status = doc.createElement("status");
        status.setTextContent(msg.cycleMs() != null ? "true" : "false");
        cyclic.appendChild(status);
        if (msg.cycleMs() != null) {
            Element cycle = doc.createElement("cycle");
            cycle.setTextContent(String.valueOf(msg.cycleMs()));
            cyclic.appendChild(cycle);
        }
        msgEl.appendChild(cyclic);

        removeChildren(msgEl, "Byte");
        // Group signals by byte position, preserving payload order
        Map<Integer, List<SignalDto>> byByte = new LinkedHashMap<>();
        for (SignalDto sig : msg.signals()) {
            byByte.computeIfAbsent(sig.byteNum(), k -> new ArrayList<>()).add(sig);
        }
        for (Map.Entry<Integer, List<SignalDto>> entry : byByte.entrySet()) {
            Element byteEl = doc.createElement("Byte");
            Element num = doc.createElement("Num");
            num.setTextContent(String.valueOf(entry.getKey()));
            byteEl.appendChild(num);
            for (SignalDto sig : entry.getValue()) {
                byteEl.appendChild(buildSignal(doc, sig));
            }
            msgEl.appendChild(byteEl);
        }
    }

    private Element buildSignal(Document doc, SignalDto sig) {
        Element signal = doc.createElement("Signal");
        signal.setAttribute("Bit", sig.bit().trim());
        Element name = doc.createElement("signal_name");
        name.setTextContent(sig.name().trim());
        signal.appendChild(name);
        for (SignalValueDto v : sig.values()) {
            if (v.value() == null || v.value().isBlank()) {
                continue;
            }
            Element values = doc.createElement("values");
            Element value = doc.createElement("value");
            value.setTextContent(v.value().trim());
            values.appendChild(value);
            Element label = doc.createElement("name");
            label.setTextContent(v.label() == null ? "" : v.label().trim());
            values.appendChild(label);
            signal.appendChild(values);
        }
        return signal;
    }

    // ── Validation ────────────────────────────────────────────────────────────

    private void validateDetail(CatalogDetailDto detail, String filename) {
        Set<String> seenIds = new HashSet<>();
        Set<String> otherFileIds = idsInOtherFiles(filename);
        for (MessageDto msg : detail.messages()) {
            String where = "message '" + msg.name() + "'";
            require(msg.name() != null && !msg.name().isBlank(), "A message has no name");
            require(msg.id() != null && MSG_ID_PATTERN.matcher(msg.id().trim()).matches(),
                    where + ": id must be hex like 0x2FC");
            String idKey = normalizeId(msg.id());
            require(seenIds.add(idKey), where + ": duplicate message id " + msg.id());
            require(!otherFileIds.contains(idKey),
                    where + ": id " + msg.id() + " already used by another catalog file");
            require(msg.cycleMs() == null || msg.cycleMs() > 0,
                    where + ": cycle must be > 0 ms");
            for (SignalDto sig : msg.signals()) {
                validateSignal(sig, where);
            }
        }
    }

    private void validateSignal(SignalDto sig, String where) {
        String sWhere = where + ", signal '" + sig.name() + "'";
        require(sig.name() != null && !sig.name().isBlank(), where + ": a signal has no name");
        require(sig.bit() != null && BIT_PATTERN.matcher(sig.bit().trim()).matches(),
                sWhere + ": bit pattern must be 8 chars of x/0/1 (e.g. xxxx1111)");
        int mask = maskOf(sig.bit().trim());
        require(mask != 0, sWhere + ": bit pattern must select at least one bit");
        int width = Integer.bitCount(mask);
        int field = mask >> Integer.numberOfTrailingZeros(mask);
        require((field & (field + 1)) == 0, sWhere + ": selected bits must be contiguous");
        require(sig.byteNum() >= 0 && sig.byteNum() <= 7, sWhere + ": byte must be 0-7");
        int max = (1 << width) - 1;
        for (SignalValueDto v : sig.values()) {
            if (v.value() == null || v.value().isBlank()) {
                continue;
            }
            try {
                int value = Integer.parseInt(v.value().trim());
                require(value >= 0 && value <= max,
                        sWhere + ": value " + value + " does not fit in " + width
                                + " bit(s) (max " + max + ")");
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException(
                        sWhere + ": value '" + v.value() + "' is not an integer");
            }
        }
    }

    /** Structural checks for raw-source saves — same rules, applied to the DOM. */
    private void validateDocument(Document doc, String filename) {
        require(firstElement(doc.getDocumentElement(), "Bus") != null,
                "XML must contain a <Bus> element");
        Set<String> seenIds = new HashSet<>();
        Set<String> otherFileIds = idsInOtherFiles(filename);
        NodeList massages = doc.getElementsByTagName("massage");
        for (int i = 0; i < massages.getLength(); i++) {
            Element m = (Element) massages.item(i);
            String id = m.getAttribute("id").trim();
            require(MSG_ID_PATTERN.matcher(id).matches(),
                    "massage '" + m.getAttribute("name") + "': id must be hex like 0x2FC");
            String idKey = normalizeId(id);
            require(seenIds.add(idKey), "duplicate message id " + id);
            require(!otherFileIds.contains(idKey),
                    "message id " + id + " already used by another catalog file");
            NodeList signals = m.getElementsByTagName("Signal");
            for (int j = 0; j < signals.getLength(); j++) {
                String bit = ((Element) signals.item(j)).getAttribute("Bit").trim();
                require(BIT_PATTERN.matcher(bit).matches(),
                        "signal bit pattern '" + bit + "' must be 8 chars of x/0/1");
            }
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalArgumentException(message);
        }
    }

    /** CAN ids declared in every catalog file except the one being edited. */
    private Set<String> idsInOtherFiles(String filename) {
        Set<String> ids = new HashSet<>();
        File dir = new File(catalogProperties.getPath());
        File[] xmlFiles = dir.listFiles((d, name) -> name.endsWith(".xml"));
        if (xmlFiles == null) {
            return ids;
        }
        for (File f : xmlFiles) {
            if (f.getName().equalsIgnoreCase(filename)) {
                continue;
            }
            try {
                Matcher m = ID_ATTR_PATTERN.matcher(Files.readString(f.toPath(), StandardCharsets.UTF_8));
                while (m.find()) {
                    ids.add(normalizeId(m.group(1)));
                }
            } catch (IOException e) {
                log.warn("Could not scan {} for id collisions: {}", f.getName(), e.getMessage());
            }
        }
        return ids;
    }

    // ── Plumbing ──────────────────────────────────────────────────────────────

    private Path catalogFile(String filename) {
        return Path.of(catalogProperties.getPath(), filename);
    }

    private Document parseXmlString(String xml) {
        try {
            Document doc = SafeXmlParserFactory.newSafeInstance().newDocumentBuilder()
                    .parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
            doc.getDocumentElement().normalize();
            return doc;
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid XML: " + e.getMessage());
        }
    }

    private void backup(Path file) throws IOException {
        Path backup = file.resolveSibling(
                file.getFileName() + ".bak-" + LocalDateTime.now().format(BACKUP_TS));
        Files.copy(file, backup);
        log.info("Catalog backup written: {}", backup.getFileName());
    }

    /** Reload the in-memory catalog and keep the DB registry row in sync. */
    private void afterSave(String filename, Document doc) {
        catalogLoaderService.load();
        Element bus = firstElement(doc.getDocumentElement(), "Bus");
        String busName = bus != null ? bus.getAttribute("Name") : "";
        final String resolvedBusName = busName;
        ecuCatalogRepository.findByFilename(filename).ifPresent(entity -> {
            entity.setBusName(resolvedBusName.isEmpty() ? "Unknown" : resolvedBusName);
            ecuCatalogRepository.save(entity);
        });
    }

    private String serialize(Document doc) throws IOException {
        try {
            TransformerFactory factory = TransformerFactory.newInstance();
            factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
            Transformer transformer = factory.newTransformer();
            transformer.setOutputProperty(OutputKeys.INDENT, "yes");
            transformer.setOutputProperty("{http://xml.apache.org/xslt}indent-amount", "2");
            StringWriter writer = new StringWriter();
            transformer.transform(new DOMSource(doc), new StreamResult(writer));
            return writer.toString();
        } catch (Exception e) {
            throw new IOException("Could not serialize catalog XML: " + e.getMessage(), e);
        }
    }

    private static String normalizeId(String id) {
        String t = id == null ? "" : id.trim();
        if (t.length() >= 2 && t.charAt(0) == '0' && (t.charAt(1) == 'x' || t.charAt(1) == 'X')) {
            return "0x" + t.substring(2).toUpperCase();
        }
        return t.toUpperCase();
    }

    private static int maskOf(String bit) {
        int mask = 0;
        for (int i = 0; i < 8 && i < bit.length(); i++) {
            if (bit.charAt(i) == '1') {
                mask |= 1 << (7 - i);
            }
        }
        return mask;
    }

    private static Element firstElement(Element parent, String tag) {
        if (tag.equals(parent.getTagName())) {
            return parent;
        }
        NodeList nl = parent.getElementsByTagName(tag);
        return nl.getLength() > 0 ? (Element) nl.item(0) : null;
    }

    private static void removeChildren(Element parent, String tag) {
        NodeList children = parent.getElementsByTagName(tag);
        // NodeList is live — collect first, then remove
        List<Node> toRemove = new ArrayList<>();
        for (int i = 0; i < children.getLength(); i++) {
            toRemove.add(children.item(i));
        }
        for (Node n : toRemove) {
            if (n.getParentNode() == parent) {
                parent.removeChild(n);
            }
        }
    }
}
