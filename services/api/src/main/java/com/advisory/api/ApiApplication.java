package com.advisory.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Scheduling is enabled for {@link DbCredentialRefresher}, which polls the
 * RDS-managed database secret so a rotated password is picked up without a
 * restart. It is the only scheduled task in the service.
 */
@SpringBootApplication
@EnableScheduling
public class ApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(ApiApplication.class, args);
    }
}
