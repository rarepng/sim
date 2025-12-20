import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'
   return {
  root: 'src', base: process.env.VITE_BASE_PATH ?? '/',

      build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {input: {app: path.resolve(__dirname, 'src/main.html')}}
      },

      server: {fs: {allow: ['..']}, open: '/main.html'},

      resolve: {
        alias: {
          '@wasm': path.resolve(
              __dirname, isProd ? './build/rel/sim.js' : './build/dbg/sim.js')
        }
      },
      plugins: [tailwindcss()]
}});
