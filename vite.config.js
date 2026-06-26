import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 3210,
    open: true
  },
  build: {
    target: 'esnext'
  }
});
