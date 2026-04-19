package com.molka.smart_analyzer_backend.simulator;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

@Component
public class XmlDefinitionLoader {

	@Value("${simulator.definitions-dir:../python_parser}")
	private String definitionsDir;

	public List<MessageDef> loadAll() {
		List<MessageDef> all = new ArrayList<>();
		File dir = new File(definitionsDir);
		if (!dir.isDirectory()) return all;
		File[] xmlFiles = dir.listFiles((d, name) -> name.endsWith(".xml"));
		if (xmlFiles == null) return all;
		for (File f : xmlFiles) {
			try {
				all.addAll(parseFile(f));
			} catch (Exception ignored) {}
		}
		return all;
	}

	private List<MessageDef> parseFile(File file) throws Exception {
		Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file);
		doc.getDocumentElement().normalize();

		String busName = doc.getDocumentElement().getAttribute("Name");
		NodeList massages = doc.getElementsByTagName("massage");
		List<MessageDef> messages = new ArrayList<>();

		for (int i = 0; i < massages.getLength(); i++) {
			Element msg = (Element) massages.item(i);
			String msgName = msg.getAttribute("name");
			String msgId = msg.getAttribute("id");

			List<SignalDef> signals = new ArrayList<>();
			NodeList signalNodes = msg.getElementsByTagName("Signal");
			for (int j = 0; j < signalNodes.getLength(); j++) {
				Element sigEl = (Element) signalNodes.item(j);
				NodeList nameNodes = sigEl.getElementsByTagName("signal_name");
				if (nameNodes.getLength() == 0) continue;
				String sigName = nameNodes.item(0).getTextContent().trim();

				List<ValidValue> validValues = new ArrayList<>();
				NodeList valuesNodes = sigEl.getElementsByTagName("values");
				for (int k = 0; k < valuesNodes.getLength(); k++) {
					Element valEl = (Element) valuesNodes.item(k);
					String rawVal = valEl.getElementsByTagName("value").item(0).getTextContent().trim();
					String label = valEl.getElementsByTagName("name").item(0).getTextContent().trim();
					// Skip range values like "0...4.294967295E9"
					if (rawVal.contains("...") || rawVal.contains("E")) continue;
					try {
						int intVal = Integer.parseInt(rawVal);
						validValues.add(new ValidValue(intVal, label));
					} catch (NumberFormatException ignored) {}
				}
				if (!validValues.isEmpty()) {
					signals.add(new SignalDef(sigName, validValues));
				}
			}
			if (!signals.isEmpty()) {
				messages.add(new MessageDef(msgName, msgId, busName, signals));
			}
		}
		return messages;
	}
}
