package com.example.backend.can.dto;

public record PlaybackErrorEvent(String type, String playbackId, String message) {}
