import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
const base = process.env.VITE_BASE_PATH ?? '/my-assets/'
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const installName = `我的资金 ${version}`
export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), {
    name: 'app-install-name',
    transformIndexHtml: (html) => html.replaceAll('__APP_INSTALL_NAME__', installName),
  }, VitePWA({
    registerType: 'prompt',
    includeAssets: ['apple-touch-icon.png'],
    manifest: {
      id: base, name: installName, short_name: installName,
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
