package com.example.backend.can.dto;

import java.util.List;

public record CatalogDetailDto(String filename, String busName, List<MessageDto> messages) {}
