# Multi-stage build: stage 1 needs Maven + JDK (~700MB of toolchain);
# stage 2 ships only a JRE + the jar. The build tools never reach
# production — smaller image, smaller attack surface.
#
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
