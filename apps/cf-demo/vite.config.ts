import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  // @ts-expect-error some dependency incompatibility
  plugins: [tailwindcss(), react(), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
