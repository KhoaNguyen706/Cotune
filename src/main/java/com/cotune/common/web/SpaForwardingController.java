package com.cotune.common.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * In production the Docker image bakes the built React app into
 * classpath:/static, so Spring serves frontend AND API from one origin —
 * one deployable, no CORS, no separate static host.
 *
 * The catch: routes like /songs/123 exist only INSIDE React Router. On a
 * hard refresh the browser asks the SERVER for /songs/123, which has no
 * such resource → 404. The fix is the SPA-fallback pattern: every
 * client-side route forwards (server-internal, not a redirect — the URL
 * bar keeps the deep link) to index.html, and React Router takes over
 * from there.
 *
 * Explicit list, not a catch-all: a /** fallback would swallow real 404s
 * (typo'd asset paths would return HTML with HTTP 200 — miserable to
 * debug). New frontend routes must be registered here; the compiler can't
 * catch that, so it's called out in the README.
 *
 * In dev (mvnw spring-boot:run, no dist baked in) these forwards 404 —
 * irrelevant, because dev uses the Vite server on :5173.
 */
@Controller
public class SpaForwardingController {

    // "/songs" (the library) is listed SEPARATELY from "/songs/{id}" (the
    // editor) on purpose: they are different URL shapes, and {id} does not
    // match the empty path. Miss it and the app works perfectly until someone
    // refreshes their own library page in production, which is the one place
    // nobody tests.
    //
    // "/admin" was exactly that miss: the tab shipped on July 15 without an
    // entry here or in SecurityConfig, so navigating to it worked (React
    // Router never asks the server) while REFRESHING it died — a 403 from
    // SecurityConfig's deny-by-default, before this controller was even
    // reached. That is the failure mode this list exists to prevent, and it
    // still got through, because the only way to trigger it is a hard
    // refresh on a page you already have open.
    @GetMapping({"/", "/login", "/register", "/songs", "/songs/{id}",
            "/listen/{token}", "/admin"})
    public String forwardToSpa() {
        return "forward:/index.html";
    }
}
