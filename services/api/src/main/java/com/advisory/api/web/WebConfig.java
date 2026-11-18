package com.advisory.api.web;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS for the React front end.
 *
 * <p>The site is served from CloudFront on its own domain and the API answers
 * on the ECS Express URL, so these are cross-origin requests. The allowed
 * origins come from Terraform, which derives them from the real domain names
 * on the certificate -- no wildcards, because credentials are allowed.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final List<String> allowedOrigins;

    public WebConfig(@Value("${app.cors.allowed-origins}") String origins) {
        this.allowedOrigins = List.of(origins.split("\\s*,\\s*"));
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "Authorization")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
