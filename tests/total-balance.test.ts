import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import type { Rate, Snapshot, Totals } from '../src/domain/ledger.ts'
import { totalChangePercent } from '../src/domain/ledger.ts'

const today = '2026-09-20'
const rate: Rate = { cnyToJpy: 20, date: '2026-09-19', fetchedAt: '2026-09-19T00:00:00Z', source: 'Frankfurter' }
const snapshot = (day: string, totals: Totals, savedRate: Rate | null = rate): Snapshot => ({ day, savedAt: `${day}T00:00:00Z`, assets: [], totals, rate: savedRate })
let server: ViteDevServer
let TotalBalance: typeof import('../src/components/TotalBalance.tsx').TotalBalance
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' })
  TotalBalance = (await server.ssrLoadModule('/src/components/TotalBalance.tsx')).TotalBalance
})
after(async () => { await server?.close() })

test('compares current total with yesterday using its saved exchange rate in either currency', () => {
  const snapshots = [snapshot('2026-09-19', { JPY: 1000, CNY: 5000 })]
  assert.equal(totalChangePercent(2100, snapshots, 'JPY', today), 5)
  assert.equal(totalChangePercent(9500, snapshots, 'CNY', today), -5)
})

test('carries the latest earlier snapshot into yesterday, excluding today and future entries', () => {
  const snapshots = [
    snapshot('2026-09-20', { JPY: 500, CNY: 0 }),
    snapshot('2026-09-16', { JPY: 100, CNY: 0 }),
    snapshot('2026-09-21', { JPY: 999, CNY: 0 }),
    snapshot('2026-09-18', { JPY: 200, CNY: 0 }),
  ]
  assert.equal(totalChangePercent(250, snapshots, 'JPY', today), 25)
  assert.equal(totalChangePercent(200, snapshots, 'JPY', today), 0)
  assert.equal(totalChangePercent(110, [snapshot('2025-12-31', { JPY: 100, CNY: 0 })], 'JPY', '2026-01-01'), 10)
})

test('uses absolute yesterday balance so reducing debt counts as an increase', () => {
  const snapshots = [snapshot('2026-09-19', { JPY: -100, CNY: 0 })]
  assert.equal(totalChangePercent(-80, snapshots, 'JPY', today), 20)
  assert.equal(totalChangePercent(-120, snapshots, 'JPY', today), -20)
})

test('omits undefined comparisons without inventing a zero percent change', () => {
  assert.equal(totalChangePercent(100, [], 'JPY', today), null)
  assert.equal(totalChangePercent(100, [snapshot(today, { JPY: 100, CNY: 0 })], 'JPY', today), null)
  assert.equal(totalChangePercent(100, [snapshot('2026-09-19', { JPY: 0, CNY: 0 })], 'JPY', today), null)
  const mixed = [snapshot('2026-09-19', { JPY: 100, CNY: 100 }, null)]
  assert.equal(totalChangePercent(100, mixed, 'JPY', today), null)
  assert.equal(totalChangePercent(null, mixed, 'JPY', today), null)
  assert.equal(totalChangePercent(110, [snapshot('2026-09-19', { JPY: 100, CNY: 0 }, null)], 'JPY', today), 10)
})

test('renders only a signed percentage after the amount with gain/loss colors and neutral zero', () => {
  for (const [total, percentage, color] of [[103, '+3.00%', 'money-up'], [98, '-2.00%', 'money-down'], [100, '0.00%', '']] as const) {
    const html = renderToStaticMarkup(createElement(TotalBalance, { total, snapshots: [snapshot('2026-09-19', { JPY: 100, CNY: 0 })], currency: 'JPY', today }))
    assert.ok(html.includes(`class="balance-change money${color ? ` ${color}` : ''}"`))
    assert.ok(html.includes(`>${percentage}</span>`))
    assert.ok(html.indexOf('</strong>') < html.indexOf('balance-change'))
  }
  const html = renderToStaticMarkup(createElement(TotalBalance, { total: 100, snapshots: [], currency: 'JPY', today }))
  assert.ok(!html.includes('balance-change'))
})
