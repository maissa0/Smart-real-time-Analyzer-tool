package com.example.backend.can.service;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

/**
 * Produces DocumentBuilderFactory instances hardened against XXE: external
 * DTDs/entities and DOCTYPE declarations are disabled so a malicious catalog
 * XML file (uploaded or on disk) cannot read local files, trigger SSRF via
 * external entity resolution, or exhaust memory via entity expansion.
 */
public final class SafeXmlParserFactory {

    private SafeXmlParserFactory() {
    }

    public static DocumentBuilderFactory newSafeInstance() throws ParserConfigurationException {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        return factory;
    }
}
