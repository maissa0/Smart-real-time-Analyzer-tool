package com.example.backend.can.controller;

import com.example.backend.can.dto.CanSessionResponse;
import com.example.backend.can.dto.DashboardStatsDto;
import com.example.backend.can.service.DashboardService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/stats")
    public ResponseEntity<DashboardStatsDto> getStats() {
        return ResponseEntity.ok(dashboardService.getStats());
    }

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @GetMapping("/recent-sessions")
    public ResponseEntity<List<CanSessionResponse>> getRecentSessions(
            @RequestParam(defaultValue = "5") int size) {
        if (size > 20) size = 20;
        return ResponseEntity.ok(dashboardService.getRecentSessions(size));
    }
}
