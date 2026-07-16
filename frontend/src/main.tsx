import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Both ship INSIDE the bundle (@fontsource) — no CDN request, no FOUT
// flash, works offline. "Self-host your fonts" is the industry default now.
//
// They live here rather than in a page because the studio redesign made
// them the WHOLE app's typefaces (--font-sans / --font-mono in styles.css),
// not one screen's: Space Grotesk for prose, JetBrains Mono for every
// number and machine label. Inter left with the violet palette.
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

// StrictMode double-invokes effects in dev to flush out unsafe ones —
// if the app misbehaves only in dev, that's usually a real bug it found.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
