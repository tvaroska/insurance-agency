import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "ui",
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/summit": "http://localhost:3005",
      "/health": "http://localhost:3005",
      "/auth": "http://localhost:3005",
    },
  },
});
