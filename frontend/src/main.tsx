import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Inter ships INSIDE the bundle (@fontsource) — no CDN request, no FOUT
// flash, works offline. "Self-host your fonts" is the industry default now.
import "@fontsource-variable/inter";
import "./styles.css";

// StrictMode double-invokes effects in dev to flush out unsafe ones —
// if the app misbehaves only in dev, that's usually a real bug it found.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
