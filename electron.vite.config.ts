import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // extNodeHost : processus de la partie Node.js des extensions
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), extNodeHost: resolve('src/main/extNodeHost.ts') } } }
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    // Version de l'app (package.json), affichée discrètement (accueil, réglages)
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '') },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
