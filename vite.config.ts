import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
const base = process.env.VITE_BASE_PATH ?? '/my-assets/'
export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['apple-touch-icon.png'],
    manifest: {
      id: base, name: '资金账本', short_name: '资金账本',
      description: '日元与人民币双币种资产统计，保存每日总资产', lang: 'zh-CN',
      start_url: base, scope: base, display: 'standalone',
      background_color: '#fff9ed', theme_color: '#fff9ed', categories: ['finance', 'productivity'],
      icons: [
        { src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${base}pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `${base}maskable-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      cacheId: 'my-assets', globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
      navigateFallback: 'index.html', cleanupOutdatedCaches: true,
    },
  })],
  server: { host: '127.0.0.1' },
})
