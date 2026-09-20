import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(import.meta.dirname, "public"),
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3777",
        changeOrigin: true,
      },
      "/events": {
        target: "http://localhost:3777",
        changeOrigin: true,
        // Disable response buffering for Server-Sent Events (SSE)
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, _req, res) => {
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
          });
        },
      },
      "/docs": {
        target: "http://localhost:3777",
        changeOrigin: true,
      },
      "/reference": {
        target: "http://localhost:3777",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: false,
    sourcemap: true,
  },
});
