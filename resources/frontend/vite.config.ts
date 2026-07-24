import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Standalone app: resources/frontend is 2 levels below the app root (was 4 levels
// below the monolith root when this lived at Modules/Inventory/resources/frontend).
const laravelRoot = path.resolve(__dirname, "../..");

/** Laravel .env may use VITE_REVERB_*="${REVERB_*}" — resolve to real values for Vite. */
function resolveEnvRef(value: string | undefined, fallback: string | undefined): string {
  const raw = (value ?? "").trim();
  if (raw === "" || raw.includes("${")) {
    return (fallback ?? "").trim();
  }
  return raw;
}

function inventoryReverbEnv(mode: string) {
  const env = loadEnv(mode, laravelRoot, "");
  return {
    VITE_REVERB_APP_KEY: resolveEnvRef(env.VITE_REVERB_APP_KEY, env.REVERB_APP_KEY),
    VITE_REVERB_HOST: resolveEnvRef(env.VITE_REVERB_HOST, env.REVERB_HOST) || "localhost",
    VITE_REVERB_PORT: resolveEnvRef(env.VITE_REVERB_PORT, env.REVERB_PORT) || "443",
    VITE_REVERB_SCHEME: resolveEnvRef(env.VITE_REVERB_SCHEME, env.REVERB_SCHEME) || "https",
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const reverb = inventoryReverbEnv(mode);

  return {
  envPrefix: 'VITE_',
  envDir: laravelRoot,
  define: {
    "import.meta.env.VITE_REVERB_APP_KEY": JSON.stringify(reverb.VITE_REVERB_APP_KEY),
    "import.meta.env.VITE_REVERB_HOST": JSON.stringify(reverb.VITE_REVERB_HOST),
    "import.meta.env.VITE_REVERB_PORT": JSON.stringify(reverb.VITE_REVERB_PORT),
    "import.meta.env.VITE_REVERB_SCHEME": JSON.stringify(reverb.VITE_REVERB_SCHEME),
  },
  // Build into public/app/ (not public/ root) so the SPA's index.html never collides
  // with Laravel's own public/index.php front controller. A single Laravel web route
  // serves public/app/index.html for "/" — see routes/web.php.
  base: "/app/",
  server: {
    host: "::",
    port: 5173,
  },
  build: {
    outDir: path.resolve(__dirname, "../../public/app"),
    // Safe to empty: this subfolder is exclusively the SPA build output, unlike
    // Laravel's public/ root which also holds index.php.
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          charts: ["recharts"],
          xlsx: ["xlsx"],
          realtime: ["laravel-echo", "pusher-js"],
        },
      },
    },
  },
  plugins: [
    react(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
};
});
