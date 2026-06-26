import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3210,
    open: true
  },
  build: {
    target: 'esnext'
  }
});
