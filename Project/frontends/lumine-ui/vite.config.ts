import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5317,
    strictPort: false,
    // tauri build 产物落在 src-tauri/target 下，不排除会被 Vite watch 到并触发无谓的 page reload
    watch: { ignored: ["**/src-tauri/target/**"] },
  },
  build: {
    target: "es2022",
    cssCodeSplit: true,
    reportCompressedSize: true,
  },
});
