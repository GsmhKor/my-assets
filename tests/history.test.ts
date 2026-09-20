import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import type { Asset, Currency, Ledger, Rate, Snapshot, Totals } from '../src/domain/ledger.ts'
import { money } from '../src/domain/ledger.ts'

let server: ViteDevServer
let History: ComponentType<{ ledger: Ledger; currency: Currency; today: string; onCorrect: (day: string, asset: Asset) => void; busy?: boolean }>
let AssetEditor: typeof import('../src/components/AssetEditor.tsx').AssetEditor
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' })
  History = (await server.ssrLoadModule('/src/components/History.tsx')).History
  AssetEditor = (await server.ssrLoadModule('/src/components/AssetEditor.tsx')).AssetEditor
})
after(async () => { await server?.close() })

const rate: Rate = { cnyToJpy: 20, date: '2026-09-16', fetchedAt: '2026-09-16T00:00:00Z', source: 'Frankfurter' }
const snapshot = (day: string, totals: Totals, savedRate: Rate | null = rate): Snapshot => ({ day, savedAt: day + 'T00:00:00Z', assets: [], totals, rate: savedRate })
const render = (snapshots: Snapshot[], currency: Currency = 'JPY') => renderToStaticMarkup(createElement(History, {
  ledger: { revision: 1, assets: [], snapshots }, currency, today: '2026-09-18', onCorrect: () => {},
}))
const panels = (html: string) => [...html.matchAll(/<section class="history-series"[^>]*>(.*?)<\/section>/gs)].map(match => match[1])
const line = (html: string, id: string) => html.match(new RegExp('d="([^"]*)" class="chart-line chart-line-' + id + '"'))?.[1]

test('overlaid 100 to 103 and 50 to 51 lines show 3% versus 2% on one shared scale in both currencies', () => {
  for (const currency of ['JPY', 'CNY'] as const) {
    const totals = currency === 'JPY' ? [{ JPY: 50, CNY: 250 }, { JPY: 51, CNY: 260 }] : [{ JPY: 1000, CNY: 5000 }, { JPY: 1040, CNY: 5100 }]
    const html = render([snapshot('2026-09-17', totals[0]), snapshot('2026-09-18', totals[1])], currency)
    assert.equal((html.match(/<svg viewBox="0 0 320 158"/g) ?? []).length, 1)
    assert.equal(line(html, 'total'), 'M 18 130 L 302 20')
    const nativeY = Number(line(html, 'native')?.match(/L 302 ([\d.]+)/)?.[1])
    assert.ok(Math.abs((130 - 20) / (130 - nativeY) - 1.5) < 1e-10)
    const stats = panels(html)
    const unit = currency === 'JPY' ? 1 : 100
    assert.equal(stats.length, 2)
    for (const [index, [min, max, percentage]] of [[100, 103, 3], [50, 51, 2]].entries()) {
      assert.ok(stats[index].includes('最高 ' + money(max * unit, currency)))
      assert.ok(stats[index].includes('最低 ' + money(min * unit, currency)))
      assert.ok(stats[index].includes(`+ ${max - min} ${currency}`))
      assert.ok(stats[index].includes('+' + percentage.toFixed(2) + '%'))
    }
  }
})

test('equal percentage changes overlap regardless of balance magnitude', () => {
  const html = render([snapshot('2026-09-17', { JPY: 100000, CNY: 4500000 }), snapshot('2026-09-18', { JPY: 101000, CNY: 4545000 })])
  assert.equal(line(html, 'total'), 'M 18 130 L 302 20')
  assert.equal(line(html, 'native'), line(html, 'total'))
})

test('a missing initial rate does not rebase the total line to a later date', () => {
  const html = render([snapshot('2026-09-17', { JPY: 100, CNY: 10000 }, null), snapshot('2026-09-18', { JPY: 200, CNY: 10000 })])
  assert.equal(line(html, 'total')?.trim(), '')
  assert.equal(line(html, 'native'), 'M 18 130 L 302 20')
  assert.match(panels(html)[0], /较昨日变化 <strong class="money">待汇率<\/strong>/)
  assert.ok(html.includes('起点缺少汇率'))
})

test('missing middle rates leave gaps and do not interrupt the native line', () => {
  const html = render([snapshot('2026-09-16', { JPY: 100, CNY: 10000 }), snapshot('2026-09-17', { JPY: 100, CNY: 10000 }, null), snapshot('2026-09-18', { JPY: 200, CNY: 10000 })])
  assert.equal((line(html, 'total')?.match(/M/g) ?? []).length, 2)
  assert.ok(!line(html, 'total')?.includes('L'))
  assert.equal((line(html, 'native')?.match(/L/g) ?? []).length, 2)
})

test('zero starting balances do not invent a percentage, while monetary changes remain visible', () => {
  const html = render([snapshot('2026-09-17', { JPY: 0, CNY: 10000 }), snapshot('2026-09-18', { JPY: 100, CNY: 10000 })])
  assert.equal(line(html, 'native')?.trim(), '')
  assert.ok(line(html, 'total')?.includes('L'))
  const native = panels(html)[1]
  assert.ok(native.includes('起点余额为 0'))
  assert.ok(native.includes('+ 100 JPY'))
  const zero = render([snapshot('2026-09-18', { JPY: 0, CNY: 0 })])
  assert.ok(!zero.includes('<svg viewBox="0 0 320 158"'))
  assert.ok(!/NaN|Infinity/.test(zero))
})

test('negative balances, flat balances and single days produce finite meaningful percentages', () => {
  const improved = render([snapshot('2026-09-17', { JPY: -100, CNY: 0 }), snapshot('2026-09-18', { JPY: -50, CNY: 0 })])
  assert.equal(line(improved, 'total'), 'M 18 130 L 302 20')
  assert.ok(improved.includes('+50.00%'))
  assert.ok(improved.includes('负债减少显示为正'))
  const declined = render([snapshot('2026-09-17', { JPY: 100, CNY: 0 }), snapshot('2026-09-18', { JPY: 90, CNY: 0 })])
  assert.equal(line(declined, 'total'), 'M 18 20 L 302 130')
  assert.ok(declined.includes('-10.00%'))
  const flat = render([snapshot('2026-09-17', { JPY: 100, CNY: 0 }), snapshot('2026-09-18', { JPY: 100, CNY: 0 })])
  assert.equal(line(flat, 'total'), 'M 18 75 L 302 75')
  assert.ok(flat.includes('0.00%'))
  const single = render([snapshot('2026-09-18', { JPY: 100, CNY: 0 })])
  assert.equal(line(single, 'total'), 'M 18 75')
  assert.ok(!/NaN|Infinity/.test(single))
  assert.equal(panels(render([])).length, 0)
})

test('history offers snapshot correction with the actual saved date but no update-today action', () => {
  const asset: Asset = { id: 'one', source: '银行账户', currency: 'JPY', amountMinor: 100, updatedDay: '2026-09-17', updatedAt: '2026-09-18T00:00:00Z' }
  const html = render([{ ...snapshot('2026-09-17', { JPY: 100, CNY: 0 }), assets: [asset] }])
  assert.ok(html.includes('银行账户'))
  assert.ok(html.includes(money(100, 'JPY')))
  assert.ok(!html.includes('更新为今日余额'))
  assert.ok(html.includes('修改历史金额'))
  assert.ok(html.includes('修改 2026-09-17 快照'))
  assert.ok(!html.includes('修改 2026-09-18 快照'))
  const disabled = renderToStaticMarkup(createElement(History, {
    ledger: { revision: 1, assets: [asset], snapshots: [{ ...snapshot('2026-09-17', { JPY: 100, CNY: 0 }), assets: [asset] }] },
    currency: 'JPY', today: '2026-09-18', onCorrect: () => {}, busy: true,
  }))
  assert.match(disabled, /class="text-button" disabled=""/)
})

test('snapshot editor locks source and currency and explains affected dates and current balance effects', () => {
  const asset: Asset = { id: 'one', source: '银行账户', currency: 'JPY', amountMinor: 100, updatedDay: '2026-09-17', updatedAt: '2026-09-17T00:00:00Z' }
  for (const affectsCurrent of [true, false]) {
    const html = renderToStaticMarkup(createElement(AssetEditor, {
      asset, history: { day: '2026-09-17', through: '2026-09-18', affectsCurrent }, currency: 'CNY',
      onClose: () => {}, onSave: async () => {}, onDelete: async () => {},
    }))
    assert.ok(html.includes('2026-09-17 的余额'))
    assert.ok(html.includes('截至 2026-09-18'))
    assert.ok(html.includes('readOnly=""'))
    assert.equal((html.match(/type="button" disabled="" aria-pressed/g) ?? []).length, 2)
    assert.ok(html.includes('保存历史修正'))
    assert.ok(!html.includes('保存今日余额'))
    assert.ok(!html.includes('删除这条资产'))
    assert.ok(html.includes(affectsCurrent ? '当前资产余额也会同步修正' : '当前资产余额保持不变'))
  }
})
