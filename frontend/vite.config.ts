import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          terminal: ["@xterm/xterm", "@xterm/addon-fit"],
        },
      },
    },
  },
});
