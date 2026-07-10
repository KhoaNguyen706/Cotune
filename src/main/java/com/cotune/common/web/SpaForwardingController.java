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

    @GetMapping({"/", "/login", "/register", "/songs/{id}"})
    public String forwardToSpa() {
        return "forward:/index.html";
    }
}
