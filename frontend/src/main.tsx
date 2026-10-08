import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Ships INSIDE the bundle (@fontsource) — no CDN request, no FOUT flash,
// works offline. "Self-host your fonts" is the industry default now.
//
// wdth.css, not the default import: the default carries only the weight
// axis, and Chassis leans on Archivo's WIDTH axis (condensed lane names,
// wide song titles — see styles.css). One file, both axes, every subset
// including Vietnamese.
import "@fontsource-variable/archivo/wdth.css";
import "./styles.css";

// StrictMode double-invokes effects in dev to flush out unsafe ones —
// if the app misbehaves only in dev, that's usually a real bug it found.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
