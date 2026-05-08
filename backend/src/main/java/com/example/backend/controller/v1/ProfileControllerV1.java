package com.example.backend.controller.v1;

import com.example.backend.dto.v1.MfaConfirmRequest;
import com.example.backend.dto.v1.MfaDisableRequest;
import com.example.backend.dto.v1.SelfPasswordChangeRequest;
import com.example.backend.dto.v1.SessionResponse;
import com.example.backend.dto.v1.UserDetailResponse;
import com.example.backend.dto.v1.UserProfileUpdateRequest;
import com.example.backend.security.CurrentUserService;
import com.example.backend.service.AvatarService;
import com.example.backend.service.MfaTotpService;
import com.example.backend.service.SessionService;
import com.example.backend.service.UserServiceV1;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Self-service profile endpoints for the Angular app.
 * Current user can update their own profile and avatar.
 */
@RestController
@RequestMapping("/api/v1/profile")
@RequiredArgsConstructor
@Tag(name = "Profile V1", description = "Self-service profile and avatar")
public class ProfileControllerV1 {

    private final UserServiceV1 userService;
    private final AvatarService avatarService;
    private final SessionService sessionService;
    private final MfaTotpService mfaTotpService;
    private final CurrentUserService currentUserService;

    @GetMapping("/me")
    @Operation(summary = "Get current user's full profile")
    public ResponseEntity<UserDetailResponse> getMyProfile() {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        UserDetailResponse profile = userService.findById(userId);
        return ResponseEntity.ok(profile);
    }

    @PutMapping("/me")
    @Operation(summary = "Update current user's profile (fullName, phone, bio)")
    public ResponseEntity<UserDetailResponse> updateMyProfile(
            @Valid @RequestBody UserProfileUpdateRequest request
    ) {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        UserDetailResponse profile = userService.updateProfile(userId, request, null);
        return ResponseEntity.ok(profile);
    }

    @PatchMapping("/me/password")
    @Operation(summary = "Change current user's password")
    public ResponseEntity<Void> changeMyPassword(
            @Valid @RequestBody SelfPasswordChangeRequest request
    ) {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        userService.changePassword(userId, new com.example.backend.dto.v1.PasswordChangeRequest(
                request.currentPassword(), request.newPassword()));
        return ResponseEntity.ok().build();
    }

    @PostMapping("/me/mfa/enable")
    @Operation(summary = "Start MFA setup - returns secret and QR code URL")
    public ResponseEntity<MfaTotpService.MfaEnableResponse> enableMfa() {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        MfaTotpService.MfaEnableResponse response = mfaTotpService.enableMfa(userId);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/me/mfa/confirm")
    @Operation(summary = "Confirm MFA - verify first code, enable MFA, returns backup codes")
    public ResponseEntity<MfaTotpService.MfaConfirmResponse> confirmMfa(@Valid @RequestBody MfaConfirmRequest request) {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        int code = Integer.parseInt(request.getCode());
        MfaTotpService.MfaConfirmResponse response = mfaTotpService.confirmMfa(userId, code);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/me/mfa/disable")
    @Operation(summary = "Disable MFA - requires current password")
    public ResponseEntity<Void> disableMfa(@Valid @RequestBody MfaDisableRequest request) {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        mfaTotpService.disableMfa(userId, request.getPassword());
        return ResponseEntity.ok().build();
    }

    @GetMapping("/me/sessions")
    @Operation(summary = "Get current user's active sessions (logged-in devices)")
    public ResponseEntity<List<SessionResponse>> getMySessions() {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        List<SessionResponse> sessions = sessionService.getSessionsForUser(userId);
        return ResponseEntity.ok(sessions);
    }

    @PostMapping(value = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Upload avatar (MultipartFile)")
    public ResponseEntity<Map<String, String>> uploadAvatar(
            @RequestParam("file") MultipartFile file
    ) throws IOException {
        UUID userId = currentUserService.getCurrentUserId()
                .orElseThrow(() -> new IllegalArgumentException("Not authenticated"));
        String avatarUrl = avatarService.uploadAvatar(userId, file);
        return ResponseEntity.ok(Map.of("avatarUrl", avatarUrl));
    }
}
