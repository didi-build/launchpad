import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * In the dev server, `/gallery` redirects to `/gallery/`, as Cloudflare does for the built site;
 * without it the dev server's single-page fallback would show the landing page there.
 */
function galleryTrailingSlash(): Plugin {
  return {
    name: "gallery-trailing-slash",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        if (url === "/gallery" || url.startsWith("/gallery?")) {
          response.statusCode = 307;
          response.setHeader("location", `/gallery/${url.slice("/gallery".length)}`);
          response.end();
          return;
        }
        next();
      });
    },
  };
}

// Two pages, built into the site that wrangler.jsonc serves (Foreman's ADR 0118 appendix E item 3):
// the project's landing page at `/` (index.html) and the component gallery at `/gallery`
// (gallery/index.html, a React app). The backend at `/api` is the Worker (src/worker/index.ts).
export default defineConfig({
  plugins: [react(), galleryTrailingSlash()],
  build: {
    outDir: "dist/site",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        gallery: resolve(root, "gallery/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
