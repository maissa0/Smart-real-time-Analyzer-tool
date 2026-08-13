package com.example.backend.can.dto;

public record PlaybackCompleteEvent(String type, String playbackId, int totalPoints) {}
