package com.example.backend.controller.v1;

import com.example.backend.security.CurrentUserService;
import com.example.backend.service.SessionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/sessions")
@RequiredArgsConstructor
@Tag(name = "Sessions V1", description = "Session management (revoke)")
public class SessionControllerV1 {

    private final SessionService sessionService;
    private final CurrentUserService currentUserService;

    @DeleteMapping("/{id}")
    @Operation(summary = "Revoke a specific session (invalidates refresh token). Own session or Admin.")
    public ResponseEntity<Void> revokeSession(@PathVariable UUID id) {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        boolean isAdmin = SecurityContextHolder.getContext().getAuthentication().getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(a -> "ROLE_ADMIN".equals(a));
        sessionService.revokeSession(id, userId, isAdmin);
        return ResponseEntity.noContent().build();
    }
}
