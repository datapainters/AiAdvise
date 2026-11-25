package com.advisory.api.auth;

import java.util.ArrayList;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
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
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final List<String> allowedOrigins;

    private final AppUserRepository users;

    public SecurityConfig(@Value("${app.cors.allowed-origins}") String origins,
            AppUserRepository users) {
        this.users = users;
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
                        // Staff accounts all carry ROLE_ADMIN; the TEAM_
                        // authority narrows what each may reach. Listed
                        // before the general /api/admin rule because the
                        // first match wins.
                        .requestMatchers("/api/admin/team", "/api/admin/team/**",
                                "/api/admin/login-events")
                        .hasAuthority(Staff.ADMIN)
                        .requestMatchers(HttpMethod.PUT, "/api/admin/options/**")
                        .hasAuthority(Staff.ADMIN)
                        .requestMatchers(
                                "/api/admin/invoices", "/api/admin/invoices/**",
                                "/api/admin/payments", "/api/admin/payments/**",
                                "/api/admin/charges/**",
                                "/api/admin/reports/**",
                                "/api/admin/billing/**",
                                "/api/admin/engagement-costs/**",
                                "/api/admin/engagements/*/costs",
                                "/api/admin/engagements/*/invoice",
                                "/api/admin/clients/*/account",
                                "/api/admin/clients/*/statement",
                                "/api/admin/clients/*/charges",
                                "/api/admin/clients/*/invoices")
                        .hasAnyAuthority(Staff.ADMIN, Staff.BILLING)
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
     * Works out what the caller may do from their account as it is now, not
     * as it was when the token was issued.
     *
     * <p>The token proves who is calling; the account row says what they are
     * allowed. Reading it per request costs one primary-key lookup and buys
     * two things a 12-hour token cannot give on its own: disabling a team
     * member locks them out on their next request, and changing someone's
     * team role takes effect at once rather than at their next sign-in.
     *
     * <p>The one thing still taken from the token is PASSWORD_RESET, which
     * marks a session that may do nothing except choose a password.
     */
    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            AppUser user;
            try {
                user = users.findById(Long.valueOf(jwt.getSubject())).orElse(null);
            } catch (NumberFormatException e) {
                user = null;
            }
            if (user == null || !user.isEnabled()) {
                return List.<GrantedAuthority>of();
            }
            if (AuthService.ROLE_PASSWORD_RESET.equals(jwt.getClaimAsString("role"))) {
                return List.<GrantedAuthority>of(
                        new SimpleGrantedAuthority("ROLE_" + AuthService.ROLE_PASSWORD_RESET));
            }
            List<GrantedAuthority> granted = new ArrayList<>();
            granted.add(new SimpleGrantedAuthority("ROLE_" + user.getRole()));
            if (user.isAdmin()) {
                granted.add(new SimpleGrantedAuthority(Staff.authorityFor(user.getTeamRole())));
            }
            return granted;
        });
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
