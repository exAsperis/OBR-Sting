import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Relative assets work both on localhost and beneath a GitHub Pages repo path.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        showcase: "index.html",
        extension: "extension.html",
        background: "background.html",
      },
    },
  },
  server: {
    cors: { origin: "https://www.owlbear.rodeo" },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
