import { defineConfig } from "vite";
import wails from "@wailsio/runtime/plugins/vite";

export default defineConfig({
  plugins: [wails("./bindings")],
  build: {
    target: "es2022",
  },
  esbuild: {
    target: "es2022",
  },
});
