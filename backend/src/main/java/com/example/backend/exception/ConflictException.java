package com.example.backend.exception;

/** Thrown when a request conflicts with existing state (e.g. a duplicate/already-exists case). */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
