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
    port: 5174,
    proxy: {
      "/coastal": "http://localhost:3006",
      "/health": "http://localhost:3006",
      "/auth": "http://localhost:3006",
    },
  },
});
