/// <reference types="vitest" />
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";

function silenceProxyErrors(proxy: import("http-proxy").Server) {
  proxy.on("error", (err, _req, res) => {
    console.warn(`[proxy] ${(err as NodeJS.ErrnoException).code ?? err.message}`);
    if (res && "writeHead" in res && !res.headersSent) {
      (res as import("http").ServerResponse).writeHead(502);
      (res as import("http").ServerResponse).end();
    }
  });
}

const devPort = parseInt(process.env.PORT || "3000", 10);
const apiPort = process.env.API_PORT || "5005";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  server: {
    host: process.env.VITE_HOST || "127.0.0.1",
    port: devPort,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/api/ws": {
        target: `ws://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        ws: true,
        configure: silenceProxyErrors,
      },
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        configure: silenceProxyErrors,
      },
      "/ws": {
        target: `ws://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        ws: true,
        configure: silenceProxyErrors,
      },
    },
  },
  build: {
    outDir: "build",
  },
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
});
