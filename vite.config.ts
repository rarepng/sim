import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    
  root: 'src', 

  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'src/main.html') 
      }
    }
  },
  
  server: {
    fs: {
      allow: ['..']
    }
  },

  resolve: {
    alias: {
      '@wasm': path.resolve(__dirname, './build/dbg/sim.js')
    }
  },
  plugins: [
    tailwindcss()
  ]
});
