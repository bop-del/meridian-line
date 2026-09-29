import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' keeps every asset URL relative, so the build works from any sub path
// (for example https://bop-del.github.io/meridian-line/) as well as from a domain root.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        musicLab: resolve(import.meta.dirname, 'music-lab.html'),
        sfxLab: resolve(import.meta.dirname, 'sfx-lab.html'),
      },
    },
  },
});
