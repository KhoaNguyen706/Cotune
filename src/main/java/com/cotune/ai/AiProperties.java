package com.cotune.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Type-safe binding of cotune.ai.* — same pattern as JwtProperties, with one
 * deliberate difference: NO bind-time validation. An empty key is not a
 * misconfiguration, it is the feature switched off — dev, CI and the demo
 * deploy all run keyless, and the advisor answers "not configured" in chat.
 * The one thing that would be wrong is a DEFAULT key in a public repo, and
 * there is none: the yml default is the empty string.
 */
@ConfigurationProperties(prefix = "cotune.ai")
public record AiProperties(String apiKey, String model) {

    public boolean enabled() {
        return apiKey != null && !apiKey.isBlank();
    }
}
