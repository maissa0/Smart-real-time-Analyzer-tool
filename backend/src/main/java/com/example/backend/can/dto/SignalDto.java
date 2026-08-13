package com.example.backend.can.dto;

import java.util.List;

public record SignalDto(String name, String bit, int byteNum, List<SignalValueDto> values) {}
