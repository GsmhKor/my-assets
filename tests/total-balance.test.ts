import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import type { Rate, Snapshot, Totals } from '../src/domain/ledger.ts'
import { totalChangeAmount } from '../src/domain/ledger.ts'

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
  assert.equal(totalChangeAmount(2100, snapshots, 'JPY', today), 100)
  assert.equal(totalChangeAmount(9500, snapshots, 'CNY', today), -500)
})

test('carries the latest earlier snapshot into yesterday, excluding today and future entries', () => {
  const snapshots = [
    snapshot('2026-09-20', { JPY: 500, CNY: 0 }),
    snapshot('2026-09-16', { JPY: 100, CNY: 0 }),
    snapshot('2026-09-21', { JPY: 999, CNY: 0 }),
    snapshot('2026-09-18', { JPY: 200, CNY: 0 }),
  ]
  assert.equal(totalChangeAmount(250, snapshots, 'JPY', today), 50)
  assert.equal(totalChangeAmount(200, snapshots, 'JPY', today), 0)
  assert.equal(totalChangeAmount(110, [snapshot('2025-12-31', { JPY: 100, CNY: 0 })], 'JPY', '2026-01-01'), 10)
})

test('reducing debt counts as an increase', () => {
  const snapshots = [snapshot('2026-09-19', { JPY: -100, CNY: 0 })]
  assert.equal(totalChangeAmount(-80, snapshots, 'JPY', today), 20)
  assert.equal(totalChangeAmount(-120, snapshots, 'JPY', today), -20)
})

test('omits missing comparisons but supports a zero previous balance', () => {
  assert.equal(totalChangeAmount(100, [], 'JPY', today), null)
  assert.equal(totalChangeAmount(100, [snapshot(today, { JPY: 100, CNY: 0 })], 'JPY', today), null)
  assert.equal(totalChangeAmount(100, [snapshot('2026-09-19', { JPY: 0, CNY: 0 })], 'JPY', today), 100)
  const mixed = [snapshot('2026-09-19', { JPY: 100, CNY: 100 }, null)]
  assert.equal(totalChangeAmount(100, mixed, 'JPY', today), null)
  assert.equal(totalChangeAmount(null, mixed, 'JPY', today), null)
  assert.equal(totalChangeAmount(110, [snapshot('2026-09-19', { JPY: 100, CNY: 0 }, null)], 'JPY', today), 10)
})

test('renders signed change amounts with gain/loss colors and neutral zero', () => {
  for (const [total, amount, color] of [[103, '+ 3', 'money-up'], [98, '- 2', 'money-down'], [100, '0', '']] as const) {
    const html = renderToStaticMarkup(createElement(TotalBalance, { total, snapshots: [snapshot('2026-09-19', { JPY: 100, CNY: 0 })], currency: 'JPY', today }))
    assert.ok(html.includes(`class="balance-change money${color ? ` ${color}` : ''}"`))
    assert.ok(html.includes(`>${amount}</span>`))
    assert.ok(html.indexOf('</strong>') < html.indexOf('balance-change'))
  }
  const html = renderToStaticMarkup(createElement(TotalBalance, { total: 100, snapshots: [], currency: 'JPY', today }))
  assert.ok(!html.includes('balance-change'))
})

test('formats whole-yuan changes without signed zero and handles large amounts', () => {
  for (const [total, expected, color] of [[1234500, '+ 12,345', 'money-up'], [-150, '- 2', 'money-down'], [-1, '0', '']] as const) {
    const html = renderToStaticMarkup(createElement(TotalBalance, { total, snapshots: [snapshot('2026-09-19', { JPY: 0, CNY: 0 })], currency: 'CNY', today }))
    assert.ok(html.includes(`>${expected}</span>`))
    assert.ok(html.includes(`class="balance-change money${color ? ` ${color}` : ''}"`))
    assert.ok(!html.includes('%'))
    assert.ok(html.includes('（—）'))
  }
})

test('renders daily percentages using the saved baseline in either currency, including debt and unchanged totals', () => {
  for (const [currency, totals, total, expected] of [
    ['JPY', { JPY: 1000, CNY: 5000 }, 2100, '+5.00%'],
    ['CNY', { JPY: 1000, CNY: 5000 }, 9500, '-5.00%'],
    ['JPY', { JPY: -100, CNY: 0 }, -80, '+20.00%'],
    ['JPY', { JPY: -100, CNY: 0 }, -120, '-20.00%'],
    ['JPY', { JPY: 100, CNY: 0 }, 100, '0.00%'],
  ] as const) {
    const html = renderToStaticMarkup(createElement(TotalBalance, { total, snapshots: [snapshot('2026-09-18', totals)], currency, today }))
    assert.ok(html.includes(`（${expected}）`))
  }
})

test('does not render a percentage when the total comparison is unavailable', () => {
  for (const [total, snapshots] of [
    [100, []],
    [null, [snapshot('2026-09-19', { JPY: 100, CNY: 0 })]],
    [100, [snapshot('2026-09-19', { JPY: 100, CNY: 100 }, null)]],
  ] as const) {
    const html = renderToStaticMarkup(createElement(TotalBalance, { total, snapshots: [...snapshots], currency: 'JPY', today }))
    assert.ok(!html.includes('balance-change'))
    assert.ok(!html.includes('%'))
  }
})
