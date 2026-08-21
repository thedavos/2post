import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import stylex from "@stylexjs/unplugin";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    stylex.vite({ dev: process.env.NODE_ENV !== "production" }),
  ],
  server: {
    proxy: {
      // Same-origin cookies during development: forward API calls to NestJS.
      "/api": { target: "http://localhost:4000", changeOrigin: false },
      "/health": { target: "http://localhost:4000", changeOrigin: false },
      "/webhooks": { target: "http://localhost:4000", changeOrigin: false },
      "/oauth": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
});
