package com.example.backend.exception;

/**
 * Returns a client-safe error message: the exception's own message only for exception types
 * whose messages are known to be user-facing validation text, a generic fallback otherwise.
 * Prevents internal details (SQL/driver errors, file paths, stack info) leaking into API
 * responses via raw {@code e.getMessage()} while preserving legitimate validation messages.
 */
public final class SafeErrorMessage {

    private SafeErrorMessage() {
    }

    public static String of(Throwable e, String fallback) {
        boolean isSafeType = e instanceof IllegalArgumentException
                || e instanceof IllegalStateException
                || e instanceof ResourceNotFoundException
                || e instanceof ConflictException;
        return isSafeType && e.getMessage() != null ? e.getMessage() : fallback;
    }
}
