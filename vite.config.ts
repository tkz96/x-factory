import path from "node:path";
import { reticle } from "@reticlehq/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [reticle(), react()],
  publicDir: path.resolve(import.meta.dirname, "public"),
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3777",
        changeOrigin: true,
      },
      "/reference": {
        target: "http://127.0.0.1:3777",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    // dist/public is wholly generated (vite build, then build:assets), so it is
    // cleared first: a file removed from the app can't linger in a later build.
    emptyOutDir: true,
    sourcemap: true,
  },
});
