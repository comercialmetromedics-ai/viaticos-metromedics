import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// En GitHub Pages la app vive en /<nombre-del-repo>/ ; el flujo de despliegue define BASE.
const base = process.env.BASE || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Viáticos Metromedics',
        short_name: 'Viáticos',
        description: 'Reporte y control de viáticos del personal de campo',
        lang: 'es-CO',
        theme_color: '#ff4f00',
        background_color: '#e9eaec',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: { navigateFallbackDenylist: [/^\/auth/], globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] }
    })
  ]
})
