import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// Bumped by hand on every push so Settings can show a version number --
// lets the user confirm they're actually on the latest deploy instead of a
// stale cached PWA build, which has been a real recurring question.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// Release notes live in release-notes.json, keyed by version. Every build
// emits them as version.json next to the app -- the update banner fetches
// the LIVE copy (bypassing every cache) to say what the waiting update is and
// what's in it. Not precached (the globPatterns below skip .json), so it
// can't go stale behind the service worker.
function versionJson() {
  return {
    name: 'bajetbro-version-json',
    apply: 'build',
    generateBundle() {
      const notes = JSON.parse(readFileSync(new URL('./release-notes.json', import.meta.url)))
      if (!notes[pkg.version]) this.warn(`release-notes.json has no notes for v${pkg.version} -- the update banner will show none`)
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: pkg.version, notes: notes[pkg.version] ?? [] }, null, 2),
      })
    },
  }
}

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
    versionJson(),
    VitePWA({
      // 'prompt': a downloaded update WAITS instead of taking over (and
      // reloading) on its own -- lib/updates.js shows the update banner and
      // only activates it when the user taps Update. Registration happens in
      // lib/updates.js via virtual:pwa-register, so nothing is injected.
      registerType: 'prompt',
      injectRegister: false,
      // Default only precaches js/css/html -- the streak buddies (webp) and
      // icons need to be there offline too.
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,svg,ico}'],
        // Take control of the page on the very FIRST install, so a new user
        // is offline-ready straight away. Updates are unaffected: in
        // 'prompt' mode a new worker still waits until the user taps Update.
        clientsClaim: true,
      },
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
