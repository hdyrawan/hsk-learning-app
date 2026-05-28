import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // hskWords.js contains ~16,000 vocabulary entries; the large chunk is expected.
    chunkSizeWarningLimit: 4000,
  },
});
