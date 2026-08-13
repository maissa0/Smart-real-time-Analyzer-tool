package com.example.backend.exception;

import com.example.backend.dto.common.ApiError;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.HashMap;
import java.util.Map;

/**
 * Global exception handler for consistent error responses.
 * Matches Angular Error Interceptor: message, errors (field -> messages).
 */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        Map<String, String[]> errors = new HashMap<>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            String field = fe.getField();
            String msg = fe.getDefaultMessage();
            errors.put(field, new String[]{msg});
        }
        ApiError apiError = ApiError.builder()
                .message("Validation failed. Please check your input.")
                .errors(errors)
                .status(HttpStatus.UNPROCESSABLE_ENTITY.value())
                .path(request.getRequestURI())
                .build();
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(apiError);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException ex, HttpServletRequest request) {
        log.warn("403 AccessDeniedException on {} {}: {}",
                request.getMethod(), request.getRequestURI(), ex.getMessage());
        ApiError apiError = ApiError.builder()
                .message("Access denied. You do not have permission to perform this action.")
                .status(HttpStatus.FORBIDDEN.value())
                .path(request.getRequestURI())
                .build();
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(apiError);
    }

    @ExceptionHandler({BadCredentialsException.class, AuthenticationException.class})
    public ResponseEntity<ApiError> handleAuthException(AuthenticationException ex, HttpServletRequest request) {
        log.warn("401 {} on {} {}: {}",
                ex.getClass().getSimpleName(), request.getMethod(), request.getRequestURI(),
                ex.getMessage());
        String msg = ex.getMessage();
        String message = (msg != null && msg.contains("Account Disabled"))
                ? "Account Disabled"
                : "Invalid email or password. Please try again.";
        ApiError apiError = ApiError.builder()
                .message(message)
                .status(HttpStatus.UNAUTHORIZED.value())
                .path(request.getRequestURI())
                .build();
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(apiError);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleIllegalArgument(IllegalArgumentException ex, HttpServletRequest request) {
        ApiError apiError = ApiError.builder()
                .message(ex.getMessage())
                .status(HttpStatus.BAD_REQUEST.value())
                .path(request.getRequestURI())
                .build();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(apiError);
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ApiError> handleConflict(ConflictException ex, HttpServletRequest request) {
        ApiError apiError = ApiError.builder()
                .message(ex.getMessage())
                .status(HttpStatus.UNPROCESSABLE_ENTITY.value())
                .path(request.getRequestURI())
                .build();
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(apiError);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(ResourceNotFoundException ex, HttpServletRequest request) {
        ApiError apiError = ApiError.builder()
                .message(ex.getMessage())
                .status(HttpStatus.NOT_FOUND.value())
                .path(request.getRequestURI())
                .build();
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(apiError);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleGeneric(Exception ex, HttpServletRequest request,
                                                  HttpServletResponse response) {
        if (response.isCommitted()) {
            log.debug("Response already committed, skipping error body: {}", ex.getMessage());
            return null;
        }
        log.error("Unexpected error", ex);
        ApiError apiError = ApiError.builder()
                .message("An unexpected error occurred. Please try again later.")
                .status(HttpStatus.INTERNAL_SERVER_ERROR.value())
                .path(request.getRequestURI())
                .build();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(apiError);
    }
}
