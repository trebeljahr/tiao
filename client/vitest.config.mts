import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared/src"),
      // Fix ESM resolution: next-intl imports "next/navigation" without .js extension
      "next/navigation": path.resolve(__dirname, "node_modules/next/navigation.js"),
      "next/headers": path.resolve(__dirname, "node_modules/next/headers.js"),
      // Stub better-auth (WIP migration — package not yet installed)
      "better-auth/react": path.resolve(__dirname, "src/test/stubs/better-auth-react.ts"),
      "better-auth/client/plugins": path.resolve(
        __dirname,
        "src/test/stubs/better-auth-client-plugins.ts",
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    server: {
      deps: {
        // Process next-intl through vite's pipeline to avoid ESM bare-specifier issues
        inline: ["next-intl"],
      },
    },
  },
});
