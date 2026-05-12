package com.example.backend.controller;

import com.example.backend.dto.auth.*;
import com.example.backend.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@Tag(name = "Authentication", description = "Login, register, refresh token, OTP verification")
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    @Operation(summary = "Login with email and password. If MFA enabled, returns 202 with mfaToken.")
    public ResponseEntity<?> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest
    ) {
        Object result = authService.login(request, httpRequest);
        if (result instanceof MfaAuthResponse mfa) {
            return ResponseEntity.status(org.springframework.http.HttpStatus.ACCEPTED).body(mfa);
        }
        return ResponseEntity.ok((AuthResponse) result);
    }

    @PostMapping("/mfa/verify")
    @Operation(summary = "Verify MFA code and complete login (returns Access/Refresh tokens)")
    public ResponseEntity<AuthResponse> verifyMfa(
            @Valid @RequestBody MfaVerifyRequest request,
            HttpServletRequest httpRequest
    ) {
        AuthResponse response = authService.verifyMfa(request, httpRequest);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/register")
    @Operation(summary = "Register a new user")
    public ResponseEntity<AuthResponse> register(
            @Valid @RequestBody RegisterRequest request,
            HttpServletRequest httpRequest
    ) {
        AuthResponse response = authService.register(request, httpRequest);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/refresh")
    @Operation(summary = "Refresh access token using refresh token")
    public ResponseEntity<AuthResponse> refresh(
            @Valid @RequestBody RefreshTokenRequest request,
            HttpServletRequest httpRequest
    ) {
        AuthResponse response = authService.refresh(request, httpRequest);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/forgot-password")
    @Operation(summary = "Request password reset (sends OTP email)")
    public ResponseEntity<Void> forgotPassword(
            @Valid @RequestBody com.example.backend.dto.auth.ForgotPasswordRequest request,
            HttpServletRequest httpRequest
    ) {
        authService.forgotPassword(request, httpRequest);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/verify-otp")
    @Operation(summary = "Verify 6-digit OTP code (returns reset token for password reset)")
    public ResponseEntity<VerifyOtpResponse> verifyOtp(
            @Valid @RequestBody VerifyOtpRequest request,
            HttpServletRequest httpRequest
    ) {
        VerifyOtpResponse response = authService.verifyOtp(request, httpRequest);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/reset-password")
    @Operation(summary = "Reset password using token from verify-otp")
    public ResponseEntity<Void> resetPassword(
            @Valid @RequestBody ResetPasswordRequest request,
            HttpServletRequest httpRequest
    ) {
        authService.resetPassword(request, httpRequest);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/set-password")
    @Operation(summary = "Set password for first-time login using invitation token")
    public ResponseEntity<Void> setPassword(
            @Valid @RequestBody ResetPasswordRequest request,
            HttpServletRequest httpRequest
    ) {
        // Reuses the same resetPassword flow — token validates, password set
        authService.resetPassword(request, httpRequest);
        return ResponseEntity.ok().build();
    }
}
