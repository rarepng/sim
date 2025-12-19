import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'
   return {
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
    },
    open: '/main.html'
  },

  resolve: {
    alias: {
        '@wasm': path.resolve(
          __dirname,
          isProd
            ? './build/rel/sim.js'
            : './build/dbg/sim.js'
        )
    }
  },
  plugins: [
    tailwindcss()
  ]
}});
