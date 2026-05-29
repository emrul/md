import { defineConfig } from "vite";
import wails from "@wailsio/runtime/plugins/vite";

export default defineConfig({
  plugins: [wails("./bindings")],

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
