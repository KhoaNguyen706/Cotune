package com.cotune.common.security;

import jakarta.servlet.ServletException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The limiter's math and keying, tested against REAL bucket4j buckets — no
 * Spring context, so limits can be tiny and the test instant. What this
 * deliberately does NOT cover is the filter being registered in the actual
 * chain; AuthFlowIntegrationTest asserts that via the X-RateLimit-Remaining
 * header every integration test's traffic crosses.
 */
class RateLimitFilterTest {

    private static final RateLimitProperties THREE_PER_MINUTE =
            new RateLimitProperties(true, 3, 100);

    @Test
    void authBudgetExhaustsInto429WithProblemJsonAndRetryAfter() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(THREE_PER_MINUTE);

        for (int i = 0; i < 3; i++) {
            assertThat(run(filter, login("10.0.0.1")).getStatus()).isEqualTo(200);
        }
        MockHttpServletResponse fourth = run(filter, login("10.0.0.1"));

        assertThat(fourth.getStatus()).isEqualTo(429);
        // The two things a WELL-BEHAVED client needs to back off correctly:
        // when to retry, and a parseable body in the app's standard shape.
        assertThat(fourth.getHeader("Retry-After")).isNotNull();
        assertThat(fourth.getContentType()).isEqualTo("application/problem+json");
        assertThat(fourth.getContentAsString()).contains("\"status\":429");
    }

    @Test
    void budgetsArePerIpNotGlobal() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(THREE_PER_MINUTE);
        for (int i = 0; i < 4; i++) {
            run(filter, login("10.0.0.1"));
        }

        // One abusive IP must never consume anyone else's budget — a global
        // bucket would let a single attacker lock every user out of login.
        assertThat(run(filter, login("10.0.0.2")).getStatus()).isEqualTo(200);
    }

    @Test
    void forwardedForUsesTheLastHopSoSpoofedEntriesDontMintFreshBudgets() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(THREE_PER_MINUTE);

        // Same trusted last hop (what Heroku's router appended), different
        // client-supplied first entries — the attack is "rotate a fake XFF
        // per request and get a fresh bucket each time". All four must land
        // in ONE bucket for the limiter to mean anything behind a router.
        for (int i = 0; i < 3; i++) {
            MockHttpServletRequest request = login("192.168.0.9");
            request.addHeader("X-Forwarded-For", "1.2.3." + i + ", 203.0.113.7");
            assertThat(run(filter, request).getStatus()).isEqualTo(200);
        }
        MockHttpServletRequest fourth = login("192.168.0.9");
        fourth.addHeader("X-Forwarded-For", "9.9.9.9, 203.0.113.7");

        assertThat(run(filter, fourth).getStatus()).isEqualTo(429);
    }

    @Test
    void generalTrafficDrawsFromItsOwnLargerBudget() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(THREE_PER_MINUTE);
        for (int i = 0; i < 4; i++) {
            run(filter, login("10.0.0.1"));
        }

        // Auth budget exhausted; the same IP's ordinary traffic (the app
        // itself: GraphQL, assets) must keep flowing — the strict bucket is
        // for BCrypt endpoints only.
        MockHttpServletRequest graphql = new MockHttpServletRequest("POST", "/graphql");
        graphql.setRemoteAddr("10.0.0.1");
        assertThat(run(filter, graphql).getStatus()).isEqualTo(200);
    }

    @Test
    void remainingBudgetIsSurfacedOnAuthResponses() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(THREE_PER_MINUTE);

        assertThat(run(filter, login("10.0.0.1")).getHeader("X-RateLimit-Remaining")).isEqualTo("2");
        assertThat(run(filter, login("10.0.0.1")).getHeader("X-RateLimit-Remaining")).isEqualTo("1");
    }

    @Test
    void disabledFilterPassesEverythingUntouched() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(new RateLimitProperties(false, 1, 1));

        for (int i = 0; i < 5; i++) {
            MockHttpServletResponse response = run(filter, login("10.0.0.1"));
            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(response.getHeader("X-RateLimit-Remaining")).isNull();
        }
    }

    private static MockHttpServletRequest login(String remoteAddr) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.setRemoteAddr(remoteAddr);
        return request;
    }

    private static MockHttpServletResponse run(RateLimitFilter filter, MockHttpServletRequest request)
            throws ServletException, IOException {
        MockHttpServletResponse response = new MockHttpServletResponse();
        // Fresh chain per call: MockFilterChain refuses to be reused, and a
        // 429 never reaches the chain anyway.
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }
}
