import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// StrictMode double-invokes effects in dev to flush out unsafe ones —
// if the app misbehaves only in dev, that's usually a real bug it found.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
