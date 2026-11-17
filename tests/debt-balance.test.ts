import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import type { Asset, Rate, Snapshot } from '../src/domain/ledger.ts'
import { creditCardDebtSummary, creditCardDebtTotal, ordinaryTotals, sumAssets } from '../src/domain/ledger.ts'

const today = '2026-11-17'
const rate: Rate = { cnyToJpy: 20, date: today, fetchedAt: `${today}T00:00:00Z`, source: 'Frankfurter' }
const asset = (source: string, amountMinor: number, currency: 'CNY' | 'JPY' = 'CNY'): Asset => ({
  id: source, source, currency, amountMinor, updatedDay: today, updatedAt: `${today}T00:00:00Z`,
})
const snapshot = (day: string, assets: Asset[], savedRate: Rate | null = rate): Snapshot => ({
  day, assets, totals: sumAssets(assets), rate: savedRate, savedAt: `${day}T00:00:00Z`,
})
let server: ViteDevServer
let DebtBalance: typeof import('../src/components/DebtBalance.tsx').DebtBalance
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' })
  DebtBalance = (await server.ssrLoadModule('/src/components/DebtBalance.tsx')).DebtBalance
})
after(async () => { await server?.close() })

test('sums only credit card names in either currency and presents the absolute aggregate', () => {
  const assets = [asset('招商信用卡', -100_000), asset('日本信用卡', -20_000, 'JPY'), asset('信用卡退款', 10_000), asset('银行卡', 9_000_000)]
  assert.equal(creditCardDebtTotal(assets, rate), 190_000)
  assert.equal(creditCardDebtTotal([asset('信用卡', 50_000)], rate), 50_000)
  assert.equal(creditCardDebtTotal([], null), 0)
  assert.ok(!Object.is(creditCardDebtTotal([asset('信用卡', 0)], null), -0))
  assert.equal(ordinaryTotals(sumAssets(assets), assets).CNY, 8_910_000)
})

test('increasing negative card balances counts as a positive debt increase', () => {
  const snapshots = [snapshot('2026-11-16', [asset('信用卡', -100_000)])]
  assert.deepEqual(creditCardDebtSummary([asset('信用卡', -120_000)], snapshots, rate, today), { total: 120_000, change: 20_000 })
  assert.deepEqual(creditCardDebtSummary([asset('信用卡', -80_000)], snapshots, rate, today), { total: 80_000, change: -20_000 })
  assert.equal(creditCardDebtSummary([asset('信用卡', -100_000)], snapshots, rate, today).change, 0)
})

test('compares the latest snapshot before today, ignoring today and future snapshots', () => {
  const snapshots = [
    snapshot(today, [asset('信用卡', -150_000)]),
    snapshot('2026-11-10', [asset('信用卡', -50_000)]),
    snapshot('2026-11-18', [asset('信用卡', -999_000)]),
    snapshot('2026-11-14', [asset('信用卡', -100_000)]),
  ]
  assert.equal(creditCardDebtSummary([asset('信用卡', -120_000)], snapshots, rate, today).change, 20_000)
  assert.equal(creditCardDebtSummary([], [], rate, today).change, null)
  assert.equal(creditCardDebtSummary([], [snapshot(today, [])], rate, today).change, null)
})

test('uses the same current exchange rate for both debt balances', () => {
  const assets = [asset('信用卡', -20_000, 'JPY')]
  const snapshots = [snapshot('2026-11-16', assets, { ...rate, cnyToJpy: 10 })]
  assert.deepEqual(creditCardDebtSummary(assets, snapshots, rate, today), { total: 100_000, change: 0 })
})

test('handles first card, repayment to zero, and unavailable currency conversion', () => {
  const assets = [asset('信用卡', -100_000)]
  assert.equal(creditCardDebtSummary(assets, [snapshot('2026-11-16', [])], null, today).change, 100_000)
  assert.equal(creditCardDebtSummary([], [snapshot('2026-11-16', assets)], null, today).change, -100_000)
  assert.deepEqual(creditCardDebtSummary([asset('信用卡', -100, 'JPY')], [], null, today), { total: null, change: null })
  assert.deepEqual(creditCardDebtSummary(assets, [snapshot('2026-11-16', [asset('信用卡', -100, 'JPY')])], null, today), { total: 100_000, change: null })
})

test('keeps debt amounts neutral and colors only the daily percentage', () => {
  const snapshots = [snapshot('2026-11-16', [asset('信用卡', -100_000)])]
  for (const [amount, text, percent, color, history] of [
    [-105_000, '1,050', '+5.00%', ' money-up', snapshots],
    [-80_000, '800', '-20.00%', ' money-down', snapshots],
    [-100_000, '1,000', '0.00%', '', snapshots],
    [-120_000, '1,200', '—', '', []],
    [-120_000, '1,200', '—', '', [snapshot('2026-11-16', [])]],
    [0, '0', '-100.00%', ' money-down', snapshots],
    [-100_010, '1,000', '+0.01%', ' money-up', snapshots],
  ] as const) {
    const html = renderToStaticMarkup(createElement(DebtBalance, { assets: [asset('信用卡', amount)], snapshots: [...history], rate, today }))
    assert.match(html, /class="finance-label">欠款<\/span>/)
    assert.match(html, new RegExp(`<b class="money">[^<]*${text}</b>`))
    assert.ok(html.includes(`class="money debt-change${color}"`))
    assert.ok(html.includes(`（${percent}）</small>`))
    assert.ok(!html.includes(`-${text}`))
    assert.ok(!html.includes('negative'))
  }
  const html = renderToStaticMarkup(createElement(DebtBalance, { assets: [asset('信用卡', -100, 'JPY')], snapshots, rate: null, today }))
  assert.ok(html.includes('class="money">待汇率</b>'))
  assert.ok(html.includes('（—）</small>'))
})
