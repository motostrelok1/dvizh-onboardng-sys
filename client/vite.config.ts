import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      manifest: false,
      injectManifest: {
        // API и uploads никогда не предзагружаются — только статическая оболочка
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
