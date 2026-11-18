import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5317, strictPort: false },
  build: {
    target: "es2022",
    cssCodeSplit: true,
    reportCompressedSize: true,
  },
});
