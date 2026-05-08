package com.example.backend.can.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "catalog")
@Getter
@Setter
public class CatalogProperties {

    private String path;
}
