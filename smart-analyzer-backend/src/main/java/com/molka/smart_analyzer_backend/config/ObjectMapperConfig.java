package com.molka.smart_analyzer_backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ObjectMapperConfig {

	/**
	 * Customises Spring Boot's auto-configured ObjectMapper instead of
	 * replacing it with a bare new ObjectMapper() (which would lose all
	 * Boot defaults such as the MVC message converters, Kafka serializers, etc.).
	 *
	 * Effects:
	 *  - JavaTimeModule  → Instant / LocalDate / ZonedDateTime get proper ser/deser
	 *  - WRITE_DATES_AS_TIMESTAMPS disabled → Instant serialises as "2024-04-26T10:00:00Z"
	 *    instead of [1714060800, 0], so Angular can parse it with new Date(string)
	 */
	@Bean
	public Jackson2ObjectMapperBuilderCustomizer javaTimeModuleCustomizer() {
		return builder -> builder
				.modules(new JavaTimeModule())
				.featuresToDisable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
	}
}
