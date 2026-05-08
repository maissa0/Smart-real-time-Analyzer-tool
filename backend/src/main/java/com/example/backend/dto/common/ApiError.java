package com.example.backend.dto.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Consistent error response for frontend Error Interceptor.
 * Matches Angular ValidationErrorResponse: message, errors (field -> messages).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiError {

    private String message;
    private Map<String, String[]> errors;
    private int status;
    private String path;
}
