package com.cotune.common.security;

import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-IP token buckets, in memory. This exists because /api/auth/login and
 * /api/auth/register are the two endpoints that are BOTH unauthenticated AND
 * expensive (BCrypt burns ~100ms of CPU per attempt, by design) — one curl
 * loop from one laptop can pin a single dyno's CPU and take the app down. No
 * botnet required. The strict bucket closes that; the generous bucket on
 * everything else blunts accidental runaway clients.
 *
 * IN-MEMORY IS A DECISION, NOT AN OVERSIGHT: at one instance a local map IS
 * the global state. The moment web > 1, each instance keeps its own budgets
 * and an attacker gets (limit × dynos) — still bounded, but move the buckets
 * to Redis (bucket4j-redis, Lettuce backend) as part of the same change that
 * scales the web process. See ROADMAP Phase 2.
 *
 * Runs BEFORE the Spring Security chain (order below): an over-limit request
 * is refused before we spend anything on it — not even JWT signature
 * verification.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@RequiredArgsConstructor
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimitProperties properties;

    // Key is "auth:<ip>" or "gen:<ip>" — one map, two budgets. ConcurrentHashMap
    // + bucket4j's lock-free buckets make the hot path allocation-free after
    // the first request from an IP.
    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    // A spoofed-XFF spray could otherwise grow the map without bound (each
    // fake IP costs ~200 bytes; 50k ≈ 10MB — real on a 512MB dyno). Clearing
    // resets everyone's budgets, which is acceptable: the refill math makes a
    // reset worth at most one extra burst per client.
    static final int MAX_TRACKED_CLIENTS = 50_000;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        if (!properties.enabled()) {
            filterChain.doFilter(request, response);
            return;
        }

        boolean authEndpoint = isAuthEndpoint(request);
        int budget = authEndpoint ? properties.authPerMinute() : properties.generalPerMinute();

        if (buckets.size() >= MAX_TRACKED_CLIENTS) {
            buckets.clear();
        }
        Bucket bucket = buckets.computeIfAbsent(
                (authEndpoint ? "auth:" : "gen:") + clientIp(request),
                key -> newBucket(budget));

        ConsumptionProbe probe = bucket.tryConsumeAndReturnRemaining(1);
        if (!probe.isConsumed()) {
            reject(response, probe);
            return;
        }
        if (authEndpoint) {
            // Surfaced on the strict endpoints only: lets a client (and our
            // integration tests) SEE the limiter working without hitting it.
            response.setHeader("X-RateLimit-Remaining", Long.toString(probe.getRemainingTokens()));
        }
        filterChain.doFilter(request, response);
    }

    private static boolean isAuthEndpoint(HttpServletRequest request) {
        return "POST".equals(request.getMethod())
                && ("/api/auth/login".equals(request.getRequestURI())
                || "/api/auth/register".equals(request.getRequestURI()));
    }

    /**
     * The client IP, Heroku-aware. Behind the Heroku router getRemoteAddr()
     * is the ROUTER, so keying on it would give every user on the planet one
     * shared budget — the limiter would DoS us better than any attacker. The
     * router appends the address it accepted the connection from to
     * X-Forwarded-For, so the LAST entry is the one hop we can trust; every
     * entry before it arrived in the client's own request and is spoofable
     * (never take the first!). No header means a direct connection (dev,
     * tests) and getRemoteAddr() is the truth.
     */
    private static String clientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor == null || forwardedFor.isBlank()) {
            return request.getRemoteAddr();
        }
        String[] hops = forwardedFor.split(",");
        return hops[hops.length - 1].trim();
    }

    // Greedy refill: the budget trickles back continuously (one auth token
    // every 60/limit seconds) rather than all at once on a minute boundary —
    // so a locked-out human regains a retry in seconds while a script never
    // gets a fresh full burst to spend.
    private static Bucket newBucket(int perMinute) {
        return Bucket.builder()
                .addLimit(limit -> limit.capacity(perMinute).refillGreedy(perMinute, Duration.ofMinutes(1)))
                .build();
    }

    // Same RFC 7807 problem+json shape RestExceptionHandler produces, written
    // by hand because this filter runs before MVC exists for this request.
    private static void reject(HttpServletResponse response, ConsumptionProbe probe) throws IOException {
        long retryAfterSeconds = Math.max(1, Duration.ofNanos(probe.getNanosToWaitForRefill()).toSeconds());
        response.setStatus(429);
        response.setHeader("Retry-After", Long.toString(retryAfterSeconds));
        response.setContentType("application/problem+json");
        response.getWriter().write("""
                {"type":"about:blank","title":"Too Many Requests","status":429,\
                "detail":"Rate limit exceeded; retry after %d seconds."}""".formatted(retryAfterSeconds));
    }
}
