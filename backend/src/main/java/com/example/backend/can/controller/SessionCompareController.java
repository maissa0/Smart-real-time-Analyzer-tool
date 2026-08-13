package com.example.backend.can.controller;

import com.example.backend.can.dto.SessionCompareRequest;
import com.example.backend.can.dto.SessionCompareResponse;
import com.example.backend.can.service.SessionCompareService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sessions")
@RequiredArgsConstructor
public class SessionCompareController {

    private final SessionCompareService sessionCompareService;

    @PreAuthorize("hasAuthority('session:read') or hasRole('ADMIN')")
    @PostMapping("/compare")
    public ResponseEntity<SessionCompareResponse> compare(@RequestBody SessionCompareRequest request) {
        return ResponseEntity.ok(sessionCompareService.compare(request.sessionIdA(), request.sessionIdB()));
    }
}
