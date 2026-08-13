package com.example.backend.config;

import com.example.backend.security.JwtAuthenticationFilter;
import com.example.backend.security.RateLimitFilter;
import com.example.backend.security.SecurityHardeningFilter;
import com.example.backend.security.SessionHeartbeatFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.http.MediaType;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.security.config.annotation.web.configuration.WebSecurityCustomizer;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthFilter;
    private final SessionHeartbeatFilter sessionHeartbeatFilter;
    private final RateLimitFilter rateLimitFilter;
    private final SecurityHardeningFilter securityHardeningFilter;
    private final UserDetailsService userDetailsService;

    @Value("${app.cors.allowed-origins}")
    private String corsAllowedOrigins;

    /**
     * Public paths — accessible without authentication.
     * Auth endpoints: login, register, password reset, MFA verification.
     * WebSocket endpoint: /ws-ecu-gateway (JWT is validated at STOMP CONNECT level
     *   by WebSocketConfig.configureClientInboundChannel — not at HTTP level).
     * API docs: Swagger UI (development only — restrict in production).
     * /error: Spring Boot's BasicErrorController. Must be public so that when a filter
     *   throws an unhandled exception, Tomcat's ERROR dispatch to /error is not blocked
     *   by anyRequest().authenticated() — which would produce a 401 instead of the real
     *   error body, masking the underlying cause entirely.
     * CSV export (/frames/export.csv) is intentionally NOT here — it requires a valid JWT
     *   like every other endpoint; JwtAuthenticationFilter accepts that JWT via a ?token=
     *   query param for this one path since it's a direct browser download link.
     * All other paths require a valid JWT — see anyRequest().authenticated() below.
     */
    private static final String[] PUBLIC_PATHS = {
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
            "/uploads/avatars/**",
            "/actuator/health",
            "/error"
    };

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        .anyRequest().authenticated()
                )
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
                )
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(apiError401EntryPoint())
                        .accessDeniedHandler(apiError403Handler())
                )
                .authenticationProvider(authenticationProvider())
                .addFilterBefore(securityHardeningFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(rateLimitFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(sessionHeartbeatFilter, JwtAuthenticationFilter.class);

        return http.build();
    }

    /**
     * Bypass Spring Security's filter chain entirely for WebSocket paths.
     * WebSocketConfig.setAllowedOriginPatterns("*") handles origin checks at the
     * protocol level; JWT is validated at STOMP CONNECT level by the channel interceptor.
     * Bypassing here prevents the Security CorsFilter from interfering with Tomcat's
     * HTTP→WebSocket upgrade handshake.
     */
    @Bean
    public WebSecurityCustomizer webSecurityCustomizer() {
        return web -> web.ignoring()
                .requestMatchers(new AntPathRequestMatcher("/ws-ecu-gateway/**"));
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.asList(corsAllowedOrigins.split(",")));
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));

        // THE FIX: Instead of hardcoding, mirror the requested headers back to the browser
        config.setAllowedHeaders(Arrays.asList("*"));

        // Expose these so the frontend can read them
        config.setExposedHeaders(Arrays.asList("Authorization", "Content-Type", "X-Requested-With"));

        config.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public AuthenticationProvider authenticationProvider() {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
        provider.setUserDetailsService(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder());
        return provider;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }

    /** Returns ApiError format for 401 (missing/invalid JWT). */
    @Bean
    public AuthenticationEntryPoint apiError401EntryPoint() {
        return (request, response, ex) -> {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            String path = request.getRequestURI() != null ? request.getRequestURI().replace("\"", "\\\"") : "";
            String body = "{\"message\":\"Unauthorized. Please login.\",\"status\":401,\"path\":\"" + path + "\"}";
            response.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        };
    }

    /** Returns ApiError format for 403 (insufficient permissions). */
    @Bean
    public AccessDeniedHandler apiError403Handler() {
        return (request, response, ex) -> {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            String path = request.getRequestURI() != null ? request.getRequestURI().replace("\"", "\\\"") : "";
            String body = "{\"message\":\"Access denied. You do not have permission to perform this action.\",\"status\":403,\"path\":\"" + path + "\"}";
            response.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        };
    }
}
