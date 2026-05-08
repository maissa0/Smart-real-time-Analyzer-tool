package com.example.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Value("${app.upload.dir:uploads/avatars}")
    private String uploadDir;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String path = uploadDir.startsWith("/") ? uploadDir : "./" + uploadDir;
        if (!path.endsWith("/")) path += "/";
        registry.addResourceHandler("/uploads/avatars/**")
                .addResourceLocations("file:" + path);
    }

    /**
     * Singleton RestTemplate bean — shared across all services.
     * Replaces per-call "new RestTemplate()" in InfluxWriteService.deleteSession()
     * to avoid connection pool exhaustion under concurrent load.
     */
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
