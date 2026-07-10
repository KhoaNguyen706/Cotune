import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev-server proxy is why the frontend needs NO CORS setup on the
// backend: the browser only ever talks to localhost:5173 (same origin),
// and Vite forwards /api and /graphql server-side to Spring. In
// production the same trick is done by nginx or the cloud LB. The
// alternative — frontend calling :8080 directly — works but forces CORS
// headers onto the backend and preflight OPTIONS requests onto every call.
const backend = process.env.VITE_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/graphql": { target: backend, changeOrigin: true },
    },
  },
});
