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
# Pre-create the audio-storage mount point OWNED BY the app user: a named
# volume adopts the image directory's ownership on first use — without
# this it materializes root-owned and uploads fail with EACCES.
RUN mkdir -p /app/data/audio && chown -R cotune:cotune /app/data
USER cotune
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
EXPOSE 8080
# CMD, NOT ENTRYPOINT — and this distinction cost a failed Heroku release.
#
# The port has to come from the environment: Heroku assigns each dyno a RANDOM
# port at runtime and routes to it via $PORT, so a hardcoded 8080 means the
# router knocks and nobody answers (R10 boot timeout). Hence the shell form,
# which can expand a variable where the exec form ["java", ...] cannot.
#
# The trap is WHICH instruction carries it. As an ENTRYPOINT, Heroku's container
# runtime does not run this as-is: it re-wraps the image's entrypoint in its own
# `sh -c` and ESCAPES every character on the way, so the dyno actually executed
#
#     sh -c exec\ java\ -Dserver.port\=\$\{PORT:-8080\}\ -jar\ app.jar
#
# — in which $PORT is no longer a variable, the spaces are no longer separators,
# and the whole line is one meaningless token. The process exited instantly with
# status 0 and the dyno crash-looped, having printed nothing at all. An empty
# crash with a zero exit status is about the least informative failure there is.
#
# CMD is overridable, so heroku.yml's `run:` block cleanly REPLACES it (an
# ENTRYPOINT would instead have had the run command appended to it as arguments,
# which is its own flavour of broken). Locally nothing changes: `docker run` and
# compose still execute this CMD, PORT is unset, and ${PORT:-8080} falls back to
# 8080 exactly as before.
#
# `exec` makes java REPLACE the shell as PID 1 rather than run as its child —
# otherwise SIGTERM on shutdown hits sh, java never hears it, and every stop is
# a 10-second wait ending in SIGKILL mid-request.
#
# ENTRYPOINT [] clears the one eclipse-temurin sets (/__cacert_entrypoint.sh).
# Our old ENTRYPOINT used to mask it; CMD does not, so without this the image
# would start as `/__cacert_entrypoint.sh <our command>` and Heroku would have a
# SECOND thing to wrap and escape. The script only does anything when
# USE_SYSTEM_CA_CERTS is set, which we don't set, so it costs nothing to drop —
# and it leaves exactly one start command, visible right here, on every platform.
ENTRYPOINT []
CMD exec java -Dserver.port=${PORT:-8080} -jar app.jar
