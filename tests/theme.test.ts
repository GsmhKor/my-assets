import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import type { Theme } from '../src/domain/theme.ts'
import { themeDetails, themePreference } from '../src/domain/theme.ts'

let server: ViteDevServer
let ThemeToggle: typeof import('../src/components/ThemeToggle.tsx').ThemeToggle
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' })
  ThemeToggle = (await server.ssrLoadModule('/src/components/ThemeToggle.tsx')).ThemeToggle
})
after(async () => { await server?.close() })

test('restores existing preferences and custom mode, defaulting missing or invalid preferences to dark', () => {
  assert.equal(themePreference('light'), 'light')
  assert.equal(themePreference('dark'), 'dark')
  assert.equal(themePreference('custom'), 'custom')
  assert.equal(themePreference(null), 'dark')
  assert.equal(themePreference('unknown'), 'dark')
  assert.equal(themeDetails.custom.colorScheme, 'dark')
  assert.equal(themeDetails.custom.browserColor, '#141210')
})

test('clicking the theme button cycles light, dark, custom, and back to light', () => {
  let theme: Theme = 'light'
  const visited: Theme[] = []
  for (let count = 0; count < 3; count++) {
    const button = ThemeToggle({ theme, onChange: next => { theme = next; visited.push(next) } })
    button.props.onClick()
  }
  assert.deepEqual(visited, ['dark', 'custom', 'light'])
})

test('the button identifies both the current theme and the next selection in every mode', () => {
  for (const [theme, current, next] of [
    ['light', '浅色', '深色'],
    ['dark', '深色', '定制'],
    ['custom', '定制', '浅色'],
  ] as const) {
    const html = renderToStaticMarkup(createElement(ThemeToggle, { theme, onChange: () => {} }))
    assert.ok(html.includes(`<span>${current}</span>`))
    assert.ok(html.includes(`aria-label="当前为${current}模式，点击切换为${next}模式"`))
    assert.ok(html.includes(`title="切换为${next}模式"`))
    assert.ok(html.includes('<svg'))
  }
})
