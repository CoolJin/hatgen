import { defineConfig } from 'vite';

// Relative base so the build works under https://<user>.github.io/<repo>/ and locally.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: 'index.html',
      output: {
        manualChunks(id) {
          // n8ao stays out of this chunk: it is loaded on demand for the high tier only.
          if (id.includes('node_modules/three') || id.includes('node_modules/postprocessing')) return 'three';
          if (id.includes('node_modules/gsap') || id.includes('node_modules/lenis')) return 'motion';
        },
      },
    },
  },
});
