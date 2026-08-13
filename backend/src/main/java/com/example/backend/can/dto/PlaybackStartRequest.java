package com.example.backend.can.dto;

import java.util.List;

public record PlaybackStartRequest(
        String sessionId,
        Double startTs,
        Double endTs,
        Double speed,
        List<String> signals,
        /** When true, frames whose msg ID has no catalogue entry (msg_name = "UNKNOWN")
         *  are also streamed as value-less points so clients can surface them.
         *  Off by default — chart consumers must not receive these. */
        Boolean includeUndecoded
) {}
