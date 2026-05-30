import { defineConfig } from "vite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import wails from "@wailsio/runtime/plugins/vite";

// Resolve the optional md-pro sibling. The @pro alias swings
// between a no-op stub and the real pro source when BOTH the env flag is
// set AND the sibling exists. The env flag mirrors the `-tags pro` build
// tag on the Go side — task build:pro sets both. Disk presence alone
// isn't enough because a pro dev might want to validate the OSS-only path
// without deleting their sibling.
//
// If PRO=1 is set but the sibling is missing, vite resolves to the stub
// silently. That's intentional — the Go side will fail loud (missing
// module) and that's the clearer error to surface.
const proRequested = process.env.PRO === "1";
const proSrc = resolve(__dirname, "../../md-pro/frontend/src");
const proStub = resolve(__dirname, "src/pro-stub");
const proPresent = existsSync(proSrc);
const proRoot = proRequested && proPresent ? proSrc : proStub;

// Wails generates pro IPC bindings under bindings/github.com/emrul/md-pro
// when -tags pro is in play. The alias works from both md and the pro
// sibling because vite aliases are global.
const proBindings = resolve(
  __dirname,
  "bindings/github.com/emrul/md-pro",
);

export default defineConfig({
  plugins: [wails("./bindings")],

  resolve: {
    alias: {
      // Stable barrel — pro source imports core via this alias instead of
      // brittle relative paths. md's own files use relative imports and
      // never need to reach for @markdownmd themselves.
      "@markdownmd": resolve(__dirname, "src/index.ts"),
      "@markdownmd/": resolve(__dirname, "src") + "/",
      "@pro": proRoot,
      "@pro/": proRoot + "/",
      "@pro-bindings": proBindings,
      "@pro-bindings/": proBindings + "/",
      // jsdiff is used by the pro diff engine, whose source lives in the md-pro
      // sibling (outside this root) and so can't resolve `diff` from this
      // node_modules on its own. Alias it to the installed ESM entry. Harmless
      // for the OSS build (nothing there imports it, so it tree-shakes out).
      diff: resolve(__dirname, "node_modules/diff/lib/index.mjs"),
    },
  },

  server: {
    // Bind IPv4 loopback: the Wails dev proxy dials tcp4 127.0.0.1, but Vite
    // otherwise binds IPv6 ::1 only, so the proxy gets connection-refused →
    // 502 on the document. (Surfaced on Wails alpha.96, which dials IPv4.)
    host: "127.0.0.1",
    port: 9245,
  },
  build: {
    target: "es2022",
  },
  esbuild: {
    target: "es2022",
  },
});
