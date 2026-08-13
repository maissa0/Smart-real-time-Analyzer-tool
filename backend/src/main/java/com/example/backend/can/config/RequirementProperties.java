package com.example.backend.can.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Directory holding user-uploaded requirement-set YAML files (per-car, dynamic). */
@Component
@ConfigurationProperties(prefix = "requirements")
@Getter
@Setter
public class RequirementProperties {

    private String path;
}
