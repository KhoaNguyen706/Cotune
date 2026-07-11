import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dev-server proxy is why the frontend needs NO CORS setup on the
// backend: the browser only ever talks to localhost:5173 (same origin),
// and Vite forwards /api and /graphql server-side to Spring. In
// production the same trick is done by nginx or the cloud LB. The
// alternative — frontend calling :8080 directly — works but forces CORS
// headers onto the backend and preflight OPTIONS requests onto every call.
const backend = process.env.VITE_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/graphql": { target: backend, changeOrigin: true },
      // ws: true is the whole difference between a working socket and a
      // baffling 400. Without it Vite proxies the HTTP request but not the
      // Upgrade handshake, so the connection is answered as plain HTTP and
      // never becomes a WebSocket. Same origin as everything else, so the
      // CORS-free story above still holds.
      "/ws": { target: backend, changeOrigin: true, ws: true },
    },
  },
});
