import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: 'frontend', plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: {
    '/api': 'http://127.0.0.1:3000', '/socket.io': { target: 'http://127.0.0.1:3000', ws: true }
  } }
});
