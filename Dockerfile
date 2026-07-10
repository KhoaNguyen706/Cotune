# Multi-stage build, now with THREE stages: the frontend is compiled by a
# Node stage and baked into the jar's classpath:/static, so ONE container
# serves the whole app (see SpaForwardingController). Neither Node nor
# Maven reaches the runtime image — smaller, smaller attack surface.
FROM node:22-alpine AS frontend
WORKDIR /fe
# Same layer-caching idea as Maven below: lockfile first, deps cached,
# source last.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# We use the maven image's own `mvn` instead of COPYing ./mvnw: the wrapper
# script is checked out with CRLF line endings on Windows hosts, and a CRLF
# shebang breaks inside a Linux container ("bad interpreter") — a classic
# cross-platform Docker trap.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Layer-caching trick: copy ONLY pom.xml and download dependencies first.
# Docker reuses a layer if its inputs are unchanged — so editing Java code
# re-runs only the compile below, not the multi-minute dependency download.
# Copy everything in one step and every build starts from zero.
COPY pom.xml .
RUN mvn -q dependency:go-offline

COPY src src
# The built SPA lands in classpath:/static — Spring Boot serves files
# there at the web root automatically.
COPY --from=frontend /fe/dist src/main/resources/static
# Tests don't run here: the image build has no database, and CI/dev is
# where tests belong. Build the artifact, test the artifact — separately.
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre-alpine
# Run as a non-root user: if the app is ever compromised, the attacker
# lands in an unprivileged account, not root-inside-the-container.
RUN addgroup -S cotune && adduser -S cotune -G cotune
USER cotune
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
