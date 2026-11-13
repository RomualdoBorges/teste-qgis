import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.GEOSERVER_URL ?? "http://localhost:8080";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Proxy evita problemas de CORS em desenvolvimento
      proxy: {
        "/geoserver": { target, changeOrigin: true },
        // API do inventário (PostgREST)
        "/api": {
          target: env.API_URL ?? "http://localhost:3000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
