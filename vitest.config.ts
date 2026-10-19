import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "security/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src"), "cloudflare:sockets": path.resolve(__dirname, "./src/test/stubs/cloudflare-sockets.ts") },
  },
});
