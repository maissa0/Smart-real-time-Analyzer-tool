package com.example.backend.can.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProcessingJobPayload(
        @JsonProperty("session_id")      String sessionId,
        @JsonProperty("file_path")       String filePath,
        @JsonProperty("source_filename") String sourceFilename,
        @JsonProperty("catalogues_dir")  String cataloguesDir,
        @JsonProperty("car_uid")         String carUid,
        /** Catalog basenames the session is scoped to — null/empty = all catalogs. */
        @JsonProperty("catalog_files")   java.util.List<String> catalogFiles
) {}
