import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In sviluppo Vite (5173) inoltra il WebSocket al server di sincronizzazione (3030).
export default defineConfig({
  plugins: [react()],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  server: {
    port: 5173,
    proxy: { "/connect": { target: "ws://localhost:3030", ws: true } },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 6000 },
});
