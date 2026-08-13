package com.example.backend.config;

import com.example.backend.can.service.CatalogService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;

@Component
@RequiredArgsConstructor
@Slf4j
public class AppStartupRunner implements ApplicationRunner {

    private final CatalogService catalogService;
    private final com.example.backend.can.service.RequirementService requirementService;

    // [TEMP-DEBUG] Mirror of SecurityConfig.PUBLIC_PATHS — kept in sync manually.
    // Remove this block and the auditSecurityMatchers() call before production.
    private static final String[] PUBLIC_PATHS_AUDIT = {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
        "/api/auth/verify-otp",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/auth/set-password",
        "/api/auth/mfa/verify",
        "/v3/api-docs/**",
        "/swagger-ui/**",
        "/swagger-ui.html",
        "/ws-ecu-gateway/**",
        "/ws-ecu-gateway",
        "/api/can/sessions/*/frames/export.csv",
        "/uploads/avatars/**",
        "/actuator/health"
    };

    // Paths to probe — the ones we care about verifying.
    private static final String[] PATHS_TO_AUDIT = {
        "/api/cars",
        "/api/cars/some-uid-1234",
        "/api/can/sessions",
        "/api/can/sessions/abc-123/frames",
        "/api/can/sessions/abc-123/frames/export.csv",   // should be PUBLIC
        "/api/can/sessions/abc/def/frames/export.csv",   // * is single-segment → should be PROTECTED
        "/api/auth/login",                               // should be PUBLIC
        "/uploads/avatars/user.png"                      // should be PUBLIC
    };

    @Override
    public void run(ApplicationArguments args) {
        log.info("Running startup catalog sync...");
        catalogService.syncExistingCatalogs();
        log.info("Startup catalog sync complete.");

        // Requirement-set registry rows are normally created on upload/save —
        // sync from disk at startup so seeded files (or files predating the
        // registry table) are assignable without a manual reload.
        try {
            log.info("Running startup requirement-set sync...");
            requirementService.reload();
            log.info("Startup requirement-set sync complete.");
        } catch (Exception e) {
            log.warn("Startup requirement-set sync failed: {}", e.getMessage());
        }

        auditSecurityMatchers();
    }

    /**
     * [TEMP-DEBUG] Prints the security rule (permitAll / authenticated) that each
     * API path resolves to, using AntPathMatcher — the same underlying engine that
     * Spring Security's AntPathRequestMatcher delegates to for URL pattern matching.
     *
     * Read the output at startup to confirm that /api/cars is NOT matched by any
     * PUBLIC_PATHS pattern and correctly falls through to anyRequest().authenticated().
     *
     * Remove before production deployment.
     */
    private void auditSecurityMatchers() {
        AntPathMatcher antMatcher = new AntPathMatcher();
        log.warn("[MATCHER-AUDIT] ── Security path resolution audit ─────────────────");
        for (String path : PATHS_TO_AUDIT) {
            String matchedPattern = null;
            for (String pattern : PUBLIC_PATHS_AUDIT) {
                if (antMatcher.match(pattern, path)) {
                    matchedPattern = pattern;
                    break;
                }
            }
            if (matchedPattern != null) {
                log.warn("[MATCHER-AUDIT]  {} → permitAll  (pattern: {})", path, matchedPattern);
            } else {
                log.warn("[MATCHER-AUDIT]  {} → anyRequest().authenticated()", path);
            }
        }
        log.warn("[MATCHER-AUDIT] ── end ─────────────────────────────────────────────");
    }
}
