package com.advisory.api.auth;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final List<String> allowedOrigins;

    public SecurityConfig(@Value("${app.cors.allowed-origins}") String origins) {
        this.allowedOrigins = List.of(origins.split("\\s*,\\s*"));
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                // Stateless bearer tokens: there is no session or cookie for
                // CSRF to attack, and a CSRF token would break the SPA.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .authorizeHttpRequests(auth -> auth
                        // Preflight must not require a token.
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/auth/login").permitAll()
                        // Unauthenticated by necessity: someone redeeming an
                        // invite has no password yet. The token in the path
                        // is the credential -- 256 bits, single use, with an
                        // expiry -- and the controller answers 404 for
                        // expired, spent and never-existed alike.
                        .requestMatchers("/api/invites/**").permitAll()
                        // The marketing site: published rate, busy slots and
                        // consultation requests. Rate limited in the controller.
                        .requestMatchers("/api/public/**").permitAll()
                        // The meeting room page. A guest from a confirmation
                        // email has no login; MeetController authorises every
                        // call itself (login, guest key or meeting token).
                        .requestMatchers("/api/meet/**").permitAll()
                        // Local development storage only; inert when media
                        // is in S3. Requests carry their own signature.
                        .requestMatchers("/api/media-local/**").permitAll()
                        // The load balancer polls these and cannot hold a token.
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers("/actuator/**").hasAuthority("ROLE_ADMIN")
                        // Reachable with any valid token, including one that
                        // carries only ROLE_PASSWORD_RESET -- otherwise a user
                        // forced to change their password could not do it.
                        .requestMatchers("/api/auth/**").authenticated()
                        .requestMatchers("/api/admin/**").hasAuthority("ROLE_ADMIN")
                        // Everything else needs a real role. This is what
                        // confines a pending-reset token to /api/auth: it
                        // authenticates but holds neither authority below.
                        .requestMatchers("/api/**")
                        .hasAnyAuthority("ROLE_CLIENT", "ROLE_ADMIN")
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));

        return http.build();
    }

    /**
     * Maps the token's {@code role} claim onto a Spring authority, so
     * {@code hasAuthority("ROLE_ADMIN")} works without a UserDetailsService.
     */
    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthorityPrefix("ROLE_");
        authorities.setAuthoritiesClaimName("role");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        // Explicit origins, never a wildcard: credentials are allowed.
        config.setAllowedOrigins(allowedOrigins);
        // PUT is here for the Meeting Manager, which upserts a note per
        // agenda item. Omitting a method fails only in a browser, at
        // preflight, so it looks like a CORS problem rather than a missing
        // verb and tests that call the API directly never catch it.
        config.setAllowedMethods(
                List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Meet-Token"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // Cost 12. Deliberately slow; login is not a hot path.
        return new BCryptPasswordEncoder(12);
    }
}
