package com.molka.smart_analyzer_backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.annotation.Nonnull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

	private static final String AUTHORIZATION_HEADER = "Authorization";
	private static final String BEARER_PREFIX = "Bearer ";

	private final JwtTokenProvider jwtTokenProvider;
	private final CustomUserDetailsService userDetailsService;

	public JwtAuthenticationFilter(JwtTokenProvider jwtTokenProvider, CustomUserDetailsService userDetailsService) {
		this.jwtTokenProvider = jwtTokenProvider;
		this.userDetailsService = userDetailsService;
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		String path = request.getServletPath();
		return path.equals("/api/users/register")
				|| path.equals("/api/users/login")
				|| path.equals("/api/users/login/mfa")
				|| path.startsWith("/ws/");
	}

	@Override
	protected void doFilterInternal(
			@Nonnull HttpServletRequest request,
			@Nonnull HttpServletResponse response,
			@Nonnull FilterChain filterChain) throws ServletException, IOException {
		String authHeader = request.getHeader(AUTHORIZATION_HEADER);
		if (authHeader == null || !authHeader.startsWith(BEARER_PREFIX)) {
			filterChain.doFilter(request, response);
			return;
		}
		String jwt = authHeader.substring(BEARER_PREFIX.length()).trim();
		if (jwt.isEmpty()) {
			filterChain.doFilter(request, response);
			return;
		}
		String username;
		try {
			username = jwtTokenProvider.getUsernameFromToken(jwt);
		} catch (Exception ex) {
			SecurityContextHolder.clearContext();
			filterChain.doFilter(request, response);
			return;
		}
		if (username != null && SecurityContextHolder.getContext().getAuthentication() == null) {
			UserDetails userDetails = userDetailsService.loadUserByUsername(username);
			if (jwtTokenProvider.isTokenValid(jwt, userDetails)) {
				UsernamePasswordAuthenticationToken authToken = new UsernamePasswordAuthenticationToken(
						userDetails, null, userDetails.getAuthorities());
				authToken.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
				SecurityContextHolder.getContext().setAuthentication(authToken);
			}
		}
		filterChain.doFilter(request, response);
	}
}
