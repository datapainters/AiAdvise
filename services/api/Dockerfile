# syntax=docker/dockerfile:1.7

###############################################################################
# Build stage
###############################################################################
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /build

# Dependencies first, so edits to source do not re-download the world.
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -q dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests package

# Explode the layered jar so the runtime image can copy layers in
# cache-friendly order.
RUN java -Djarmode=layertools -jar target/api-*.jar extract --destination /build/layers

###############################################################################
# Runtime stage
#
# Distroless: no shell, no package manager, nothing for an attacker to pivot
# into. If you need `kubectl exec`-style debugging, ECS Exec is wired up in
# the task role -- use that instead of adding a shell back in.
###############################################################################
FROM gcr.io/distroless/java21-debian12:nonroot AS runtime

WORKDIR /app

COPY --from=build /build/layers/dependencies/ ./
COPY --from=build /build/layers/spring-boot-loader/ ./
COPY --from=build /build/layers/snapshot-dependencies/ ./
COPY --from=build /build/layers/application/ ./

EXPOSE 8080

# Container-aware heap sizing; Fargate memory is a hard ceiling and the JVM
# default of 25% leaves most of it unused.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:InitialRAMPercentage=50 -XX:+UseG1GC -Djava.security.egd=file:/dev/./urandom"

# Defaults so the image is runnable even if the orchestrator passes nothing.
# Terraform overrides these per environment; DB_SECRET_ARN has no sensible
# default and must be supplied, which is why DataSourceConfig fails loudly
# when it is missing rather than falling back to something wrong.
ENV SPRING_PROFILES_ACTIVE=prod \
    SERVER_PORT=8080

USER nonroot

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
