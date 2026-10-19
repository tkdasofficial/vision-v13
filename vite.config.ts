// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

// Pages that must never be served from the offline cache (sign-in, admin, server endpoints).
const NO_CACHE_PAGES = /^\/(api|auth|admin|~oauth|_serverFn|google|github|verify|enterprise)(\/|$)/;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        // Dev-only stand-in for the Worker runtime builtin used by auth-gateway/src/mail.ts.
        // The production build externalizes it instead (build.rolldownOptions.external below),
        // so the deployed Worker uses the real builtin.
        "cloudflare:sockets": new URL("./src/test/stubs/cloudflare-sockets.ts", import.meta.url).pathname,
      },
    },
    build: {
      rolldownOptions: {
        // cloudflare:sockets is a Worker runtime builtin (used by auth-gateway/src/mail.ts
        // for SMTP); it must stay an external import in the server bundle.
        external: ["cloudflare:sockets"],
      },
    },
    plugins: [
      {
        name: "vision-dev-backend-origin",
        configureServer() {
          // Public development configuration only; credentials remain on Cloudflare.
          process.env["API_ORIGIN"] ||= "https://vision.tusharkantidasofficial.workers.dev";
        },
      },
      // Only the browser build gets a service worker; it is written next to the public files.
      ...VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null, // registration happens only in src/lib/pwa.ts
        devOptions: { enabled: false },
        manifest: false,
        filename: "sw.js",
        outDir: "dist/client",
        workbox: {
          // Versioned app files (hashed names) are precached; Workbox keeps the old cache until the new one is complete.
          globDirectory: "dist/client",
          globPatterns: ["**/*.{js,css,woff,woff2,svg,png,ico}"],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: null,
          runtimeCaching: [
            {
              // Pages: always try the network first; the cached copy is only used offline.
              urlPattern: ({ request, url, sameOrigin }) =>
                sameOrigin && request.mode === "navigate" && !NO_CACHE_PAGES.test(url.pathname),
              handler: "NetworkFirst",
              options: {
                cacheName: "vision-pages-v1",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 3600 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
              handler: "StaleWhileRevalidate",
              options: { cacheName: "vision-font-css-v1" },
            },
            {
              urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
              handler: "CacheFirst",
              options: {
                cacheName: "vision-fonts-v1",
                expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 3600 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }).map((p) => ({ ...p, applyToEnvironment: (env: { name: string }) => env.name === "client" })),
    ],
  },
});
