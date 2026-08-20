import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// Bumped by hand on every push so Settings can show a version number --
// lets the user confirm they're actually on the latest deploy instead of a
// stale cached PWA build, which has been a real recurring question.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// https://vite.dev/config/
export default defineConfig({
  base: '/BajetBro/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // Personal backup JSON and source images sit in the project root (see
    // .gitignore) but aren't part of the app -- watching them trips
    // OneDrive's placeholder/sync locking and crashes Vite's native
    // fs.watch. Mirrors the "Personal financial data" and "Source data
    // images" sections of .gitignore.
    watch: {
      ignored: [
        '**/bajetbro-*.json',
        '**/[Bb]ajet*[Dd]ata*.json',
        '**/[Bb]ajetbro-[Ii]nitial*.json',
        '**/*weird data*.json',
        '**/*.jpg',
        '**/*.jpeg',
        '**/*.png',
      ],
    },
    // Bind all interfaces so the dev server is reachable over Tailscale
    // (e.g. from a phone) at the machine's Tailscale IP, not just localhost.
    host: true,
    port: 5173,
    strictPort: true,
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'BajetBro',
        short_name: 'BajetBro',
        description: 'Personal budgeting tracker',
        theme_color: '#efe9d8',
        background_color: '#efe9d8',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
