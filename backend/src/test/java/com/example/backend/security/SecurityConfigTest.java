package com.example.backend.security;

import com.example.backend.can.service.CanSessionService;
import com.example.backend.can.service.InfluxQueryService;
import com.example.backend.can.service.InfluxWriteService;
import com.example.backend.can.service.LogUploadService;
import com.example.backend.can.service.PlaybackService;
import com.example.backend.service.AuditService;
import com.example.backend.service.EmailService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Security integration tests — verify PUBLIC_PATHS and anyRequest().authenticated()
 * are correctly configured in SecurityConfig.
 *
 * Strategy:
 * - @SpringBootTest loads the real SecurityFilterChain
 * - schema-test.sql creates all tables in H2 (ddl-auto=none avoids DROP issues)
 * - External infra mocks: Kafka, InfluxDB, CAN services; EmailService mocked;
 *   JavaMailSender left real so Actuator mail health does not fail (empty composite).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityConfigTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @MockitoBean
    private UserDetailsService userDetailsService;

    @MockitoBean
    private InfluxWriteService influxWriteService;

    @MockitoBean
    private InfluxQueryService influxQueryService;

    @MockitoBean
    private CanSessionService canSessionService;

    @MockitoBean
    private LogUploadService logUploadService;

    @MockitoBean
    private PlaybackService playbackService;

    @MockitoBean
    private AuditService auditService;

    @MockitoBean
    private EmailService emailService;

    // ── Test 1 ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GET /api/can/sessions without token → 401 Unauthorized")
    void canSessions_withoutToken_returns401() throws Exception {
        mockMvc.perform(get("/api/can/sessions"))
                .andExpect(status().isUnauthorized());
    }

    // ── Test 2 ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("POST /api/logs/upload without token → 401 Unauthorized")
    void logsUpload_withoutToken_returns401() throws Exception {
        mockMvc.perform(post("/api/logs/upload"))
                .andExpect(status().isUnauthorized());
    }

    // ── Test 3 ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("POST /api/auth/login without token → not 401 (public endpoint)")
    void authLogin_withoutToken_isPublic() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(result ->
                        org.junit.jupiter.api.Assertions.assertNotEquals(
                                401,
                                result.getResponse().getStatus(),
                                "Login must not return 401 — it is declared public in PUBLIC_PATHS"
                        )
                );
    }

    // ── Test 4 ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GET /api/can/sessions with valid JWT → not 401 (authenticated)")
    void canSessions_withValidToken_isAuthenticated() throws Exception {
        UUID userId = UUID.randomUUID();
        String email = "test@kpit.com";

        var userDetails = User.withUsername(email)
                .password("irrelevant")
                .authorities(Collections.emptyList())
                .build();
        when(userDetailsService.loadUserByUsername(anyString()))
                .thenReturn(userDetails);

        String token = jwtService.generateAccessToken(email, userId);

        mockMvc.perform(get("/api/can/sessions")
                        .header("Authorization", "Bearer " + token))
                .andExpect(result ->
                        org.junit.jupiter.api.Assertions.assertNotEquals(
                                401,
                                result.getResponse().getStatus(),
                                "Valid JWT must not produce 401"
                        )
                );
    }
}
