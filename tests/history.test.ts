import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import type { Asset, Currency, Ledger, Rate, Snapshot, Totals } from '../src/domain/ledger.ts'
import { money } from '../src/domain/ledger.ts'
import { historyScale } from '../src/components/historyScale.ts'

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
const curvePoints = (html: string, id: string) => [...(line(html, id) ?? '').matchAll(/[MLC]\s+([^MLC]+)/g)]
  .map(match => {
    const coordinates = match[1].trim().split(/\s+/).map(Number)
    return { x: coordinates.at(-2)!, y: coordinates.at(-1)! }
  })

test('both currencies use actual amounts, with daily changes above a single chart', () => {
  for (const currency of ['JPY', 'CNY'] as const) {
    const totals = currency === 'JPY' ? [{ JPY: 50, CNY: 250 }, { JPY: 51, CNY: 260 }] : [{ JPY: 1000, CNY: 5000 }, { JPY: 1040, CNY: 5100 }]
    const html = render([snapshot('2026-09-17', totals[0]), snapshot('2026-09-18', totals[1])], currency)
    assert.equal((html.match(/<svg viewBox="0 0 320 158"/g) ?? []).length, 1)
    const total = curvePoints(html, 'total')
    const native = curvePoints(html, 'native')
    assert.deepEqual(total.map(point => point.x), native.map(point => point.x))
    assert.ok(total.every((point, index) => point.y < native[index].y))
    assert.ok(Math.abs((total[0].y - total[1].y) / (native[0].y - native[1].y) - 3) < 1e-10)
    assert.ok(html.includes('class="chart-break"'))
    assert.ok(!html.includes('省略无数据区间 · 等比例'))
    assert.ok(html.indexOf('实际') < html.indexOf('<svg'))
    assert.ok(html.indexOf('+2.00%') < html.indexOf('<svg'))
    assert.ok(!html.includes('较起点'))
    const stats = panels(html)
    const unit = currency === 'JPY' ? 1 : 100
    assert.equal(stats.length, 2)
    for (const [index, [min, max, percentage]] of [[100, 103, 3], [50, 51, 2]].entries()) {
      assert.ok(stats[index].includes('最高 ' + money(max * unit, currency)))
      assert.ok(stats[index].includes('最低 ' + money(min * unit, currency)))
      assert.ok(stats[index].includes(`>+ ${max - min}</strong>`))
      assert.ok(stats[index].includes('+' + percentage.toFixed(2) + '%'))
    }
  }
})

test('native share uses the latest total converted into the selected currency', () => {
  const snapshots = [snapshot('2026-09-17', { JPY: 500, CNY: 2500 }), snapshot('2026-09-18', { JPY: 200, CNY: 4000 })]
  const heading = (html: string) => panels(html)[1].match(/<h3>(.*?)<\/h3>/s)?.[1].replace(/<[^>]+>/g, '')
  assert.equal(heading(render(snapshots, 'JPY')), '实际日元资产(20%)')
  assert.equal(heading(render(snapshots, 'CNY')), '实际人民币资产(80%)')
  assert.equal(heading(render([snapshot('2026-09-18', { JPY: 100, CNY: 1000 })])), '实际日元资产(33.33%)')
  assert.equal(heading(render([snapshot('2026-09-18', { JPY: 0, CNY: 1000 })])), '实际日元资产(0%)')
  for (const saved of [snapshot('2026-09-18', { JPY: 200, CNY: -1000 }), snapshot('2026-09-18', { JPY: 200, CNY: 1000 }, null)]) {
    assert.equal(heading(render([saved])), '实际日元资产(—)')
  }
})

test('equal percentage changes retain different amount heights and absolute slopes', () => {
  const html = render([snapshot('2026-09-17', { JPY: 100000, CNY: 4500000 }), snapshot('2026-09-18', { JPY: 101000, CNY: 4545000 })])
  const total = curvePoints(html, 'total')
  const native = curvePoints(html, 'native')
  assert.ok(total.every((point, index) => point.y < native[index].y))
  assert.ok(Math.abs((total[0].y - total[1].y) / (native[0].y - native[1].y) - 10) < 1e-10)
})

test('a missing initial rate leaves later available total amounts visible', () => {
  const html = render([snapshot('2026-09-17', { JPY: 100, CNY: 10000 }, null), snapshot('2026-09-18', { JPY: 200, CNY: 10000 })])
  assert.equal(curvePoints(html, 'total').length, 1)
  assert.equal(curvePoints(html, 'total')[0].x, curvePoints(html, 'native')[1].x)
  assert.equal(curvePoints(html, 'native').length, 2)
  assert.match(panels(html)[0], /class="chart-change-values"><strong class="money">待汇率<\/strong>/)
  assert.ok(html.includes('缺少汇率的日期不绘制折算总资产数据'))
  const missing = render([snapshot('2026-09-18', { JPY: 100, CNY: 10000 }, null)])
  assert.equal(line(missing, 'total'), '')
  assert.equal(curvePoints(missing, 'native').length, 1)
  assert.ok(!missing.includes('class="chart-break"'))
})

test('missing middle rates leave gaps and do not interrupt the native line', () => {
  const html = render([snapshot('2026-09-16', { JPY: 100, CNY: 10000 }), snapshot('2026-09-17', { JPY: 100, CNY: 10000 }, null), snapshot('2026-09-18', { JPY: 200, CNY: 10000 })])
  assert.equal((line(html, 'total')?.match(/M/g) ?? []).length, 2)
  assert.ok(!line(html, 'total')?.includes('L'))
  assert.equal((line(html, 'native')?.match(/C/g) ?? []).length, 2)
})

test('zero balances are plotted without inventing a daily percentage', () => {
  const html = render([snapshot('2026-09-17', { JPY: 0, CNY: 10000 }), snapshot('2026-09-18', { JPY: 100, CNY: 10000 })])
  assert.equal(curvePoints(html, 'native').length, 2)
  assert.ok(line(html, 'total')?.includes('L'))
  const native = panels(html)[1]
  assert.ok(native.includes('昨日余额为 0'))
  assert.ok(!native.match(/<p class="chart-change">(.*?)<\/p>/s)?.[1].includes('%'))
  assert.ok(native.includes('>+ 100</strong>'))
  const zero = render([snapshot('2026-09-18', { JPY: 0, CNY: 0 })])
  assert.equal(curvePoints(zero, 'total').length, 1)
  assert.deepEqual(curvePoints(zero, 'total'), curvePoints(zero, 'native'))
  assert.ok(!/NaN|Infinity/.test(zero))
})

test('negative balances, flat balances and single days retain true amount ordering', () => {
  const improved = render([snapshot('2026-09-17', { JPY: -100, CNY: 0 }), snapshot('2026-09-18', { JPY: -50, CNY: 0 })])
  assert.ok(curvePoints(improved, 'total')[0].y > curvePoints(improved, 'total')[1].y)
  assert.ok(improved.includes('+50.00%'))
  const declined = render([snapshot('2026-09-17', { JPY: 100, CNY: 0 }), snapshot('2026-09-18', { JPY: 90, CNY: 0 })])
  assert.ok(curvePoints(declined, 'total')[0].y < curvePoints(declined, 'total')[1].y)
  assert.ok(declined.includes('-10.00%'))
  const flat = render([snapshot('2026-09-17', { JPY: 100, CNY: 0 }), snapshot('2026-09-18', { JPY: 100, CNY: 0 })])
  assert.equal(curvePoints(flat, 'total')[0].y, curvePoints(flat, 'total')[1].y)
  assert.equal(line(flat, 'total'), line(flat, 'native'))
  assert.ok(!flat.includes('class="chart-break"'))
  assert.ok(flat.includes('0.00%'))
  const single = render([snapshot('2026-09-18', { JPY: 100, CNY: 0 })])
  assert.equal(curvePoints(single, 'total').length, 1)
  assert.ok(!/NaN|Infinity/.test(single))
  assert.equal(panels(render([])).length, 0)
  const debt = render([snapshot('2026-09-17', { JPY: 2000, CNY: -1000 }), snapshot('2026-09-18', { JPY: 2100, CNY: -1000 })])
  assert.ok(curvePoints(debt, 'total').every((point, index) => point.y > curvePoints(debt, 'native')[index].y))
})

test('broken amount axis omits only empty space and preserves the same money scale in both bands', () => {
  for (const unit of [1, 100]) {
    const low = { min: 1750000 * unit, max: 1850000 * unit }
    const high = { min: 6800000 * unit, max: 6950000 * unit }
    const scale = historyScale([high, low], unit)
    const gap = scale.axisBreak
    assert.ok(gap)
    assert.ok(gap.from > low.max && gap.to < high.min)
    assert.ok(Math.abs(gap.bottom - gap.top - 26) < 1e-10)
    assert.ok(Math.abs((scale.y(low.min) - scale.y(low.max)) / (scale.y(high.min) - scale.y(high.max)) - 2 / 3) < 1e-10)
    assert.ok(scale.y(high.min) < scale.y(low.max))
    for (const value of [low.min, low.max, high.min, high.max, ...scale.ticks]) {
      const position = scale.y(value)
      assert.ok(position >= scale.top - 1e-10 && position <= scale.bottom + 1e-10)
      assert.ok(position <= gap.top + 1e-10 || position >= gap.bottom - 1e-10)
    }
  }
})

test('overlapping, touching and nearby amount ranges use a continuous common axis', () => {
  for (const second of [{ min: 150, max: 300 }, { min: 200, max: 300 }, { min: 210, max: 300 }]) {
    const scale = historyScale([{ min: 100, max: 200 }, second], 1)
    assert.equal(scale.axisBreak, null)
    assert.ok(Math.abs((scale.y(100) - scale.y(200)) - (scale.y(200) - scale.y(300))) < 1e-10)
  }
  const crossing = render([snapshot('2026-09-17', { JPY: 100, CNY: 100 }), snapshot('2026-09-18', { JPY: 110, CNY: -100 })])
  assert.ok(!crossing.includes('class="chart-break"'))
  assert.ok(curvePoints(crossing, 'total')[0].y < curvePoints(crossing, 'native')[0].y)
  assert.ok(curvePoints(crossing, 'total')[1].y > curvePoints(crossing, 'native')[1].y)
})

test('empty, constant, negative and very large amount ranges produce finite distinct ticks', () => {
  for (const ranges of [[], [{ min: null, max: null }], [{ min: 0, max: 0 }], [{ min: -200, max: -100 }, { min: 1000, max: 1000 }], [{ min: 1800000, max: 1800000 }, { min: 6900000, max: 6900000 }], [{ min: 1, max: 2 }, { min: 9e15 - 10, max: 9e15 }]]) {
    const scale = historyScale(ranges, 1)
    assert.equal(new Set(scale.ticks).size, scale.ticks.length)
    for (const value of scale.ticks) assert.ok(Number.isFinite(scale.y(value)))
    for (const range of ranges) {
      if (range.min === null || range.max === null) continue
      assert.ok(scale.y(range.min) >= scale.y(range.max))
      assert.ok(scale.y(range.min) <= scale.bottom + 1e-10)
      assert.ok(scale.y(range.max) >= scale.top - 1e-10)
    }
  }
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
