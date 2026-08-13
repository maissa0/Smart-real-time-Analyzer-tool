package com.example.backend.can.config;

import com.example.backend.security.JwtService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
@Slf4j
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final JwtService jwtService;
    private final UserDetailsService userDetailsService;

    @Value("${app.cors.allowed-origins}")
    private String corsAllowedOrigins;

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic");
        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Same origin list as the HTTP CORS config (app.cors.allowed-origins) — JWT is
        // still validated at STOMP CONNECT level (see configureClientInboundChannel)
        // regardless, but the origin check should not be a wildcard in production.
        registry.addEndpoint("/ws-ecu-gateway")
                .setAllowedOrigins(corsAllowedOrigins.split(","))
                .withSockJS();
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                        MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
                    String authHeader = accessor.getFirstNativeHeader("Authorization");
                    if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                        log.warn("WebSocket STOMP CONNECT rejected: missing Authorization header");
                        throw new IllegalArgumentException("STOMP CONNECT requires a Bearer token");
                    }
                    String token = authHeader.substring(7);
                    try {
                        if (!jwtService.isTokenValid(token)) {
                            // Previously this returned the message silently, allowing an
                            // unauthenticated STOMP session. Now it rejects the CONNECT so
                            // the client receives a proper error and must re-authenticate.
                            log.warn("WebSocket STOMP CONNECT rejected: invalid or expired JWT");
                            throw new IllegalArgumentException("STOMP CONNECT rejected: invalid or expired JWT");
                        }
                        String email = jwtService.getEmailFromToken(token);
                        var userDetails = userDetailsService.loadUserByUsername(email);
                        var auth = new UsernamePasswordAuthenticationToken(
                                userDetails, null, userDetails.getAuthorities());
                        accessor.setUser(auth);
                        log.debug("WebSocket STOMP CONNECT authenticated: user={}", email);
                    } catch (IllegalArgumentException e) {
                        throw e;
                    } catch (Exception e) {
                        log.warn("WebSocket JWT validation failed: {}", e.getMessage());
                        throw new IllegalArgumentException("STOMP CONNECT rejected: JWT validation error");
                    }
                }
                return message;
            }
        });
    }
}
