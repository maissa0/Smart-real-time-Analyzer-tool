package com.example.backend.can.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Builder
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class SessionDeleteResult {
    private String sessionId;
    private long deletedFrames;
    private long deletedFaults;
    private String status;
    private boolean influxDeleted;
}
