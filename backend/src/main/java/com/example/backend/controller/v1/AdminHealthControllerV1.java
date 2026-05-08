package com.example.backend.controller.v1;

import com.example.backend.security.CurrentUserService;
import com.example.backend.service.MailHealthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin/health")
@RequiredArgsConstructor
@Tag(name = "Admin Health", description = "Health check endpoints (admin only)")
public class AdminHealthControllerV1 {

    private final MailHealthService mailHealthService;
    private final CurrentUserService currentUserService;

    @GetMapping("/mail")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "Send a test email to verify SMTP connection")
    public ResponseEntity<Map<String, String>> checkMail() {
        UUID adminId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        Map<String, String> result = mailHealthService.sendTestEmail(adminId);
        return ResponseEntity.ok(result);
    }
}
