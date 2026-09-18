import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import type { Asset, Currency, Draft, Ledger, Rate, Snapshot, Totals } from '../src/domain/ledger.ts'
import { money } from '../src/domain/ledger.ts'

let server: ViteDevServer
let History: ComponentType<{ ledger: Ledger; currency: Currency; today: string; onEdit: () => void; onCorrect: () => void }>
let AssetEditor: ComponentType<{ asset: Asset; history: { day: string; through: string; affectsCurrent: boolean }; currency: Currency; onClose: () => void; onSave: (draft: Draft) => Promise<void>; onDelete: (id: string) => Promise<void> }>
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
  History = (await server.ssrLoadModule('/src/components/History.tsx')).History
  AssetEditor = (await server.ssrLoadModule('/src/components/AssetEditor.tsx')).AssetEditor
})
after(async () => { await server?.close() })

const rate: Rate = { cnyToJpy: 20, date: '2026-09-16', fetchedAt: '2026-09-16T00:00:00Z', source: 'Frankfurter' }
const snapshot = (day: string, totals: Totals, savedRate: Rate | null = rate): Snapshot => ({ day, savedAt: `${day}T00:00:00Z`, assets: [], totals, rate: savedRate })
const render = (snapshots: Snapshot[], currency: Currency = 'JPY') => renderToStaticMarkup(createElement(History, {
  ledger: { revision: 1, assets: [], snapshots }, currency, today: '2026-09-18', onEdit: () => {}, onCorrect: () => {},
}))
const panels = (html: string) => [...html.matchAll(/<section class="history-series"[^>]*>(.*?)<\/section>/gs)].map(match => match[1])

test('each history line has its own range and visible movement despite a tenfold balance difference', () => {
  const snapshots = [snapshot('2026-09-17', { JPY: 100000, CNY: 4500000 }), snapshot('2026-09-18', { JPY: 101000, CNY: 4545000 })]
  for (const currency of ['JPY', 'CNY'] as const) {
    const charts = panels(render(snapshots, currency))
    assert.equal(charts.length, 2)
    const expected = currency === 'JPY' ? [[1000000, 1010000], [100000, 101000]] : [[5000000, 5050000], [4500000, 4545000]]
    charts.forEach((chart, index) => {
      const [min, max] = expected[index]
      assert.ok(chart.includes(`最高 ${money(max, currency)}`))
      assert.ok(chart.includes(`最低 ${money(min, currency)}`))
      assert.ok(chart.includes(`+${money(max - min, currency)}`))
      assert.match(chart, /d="M 18 130 L 302 20"/)
    })
  }
})

test('missing rates do not suppress the native chart or invent an endpoint change', () => {
  const [total, native] = panels(render([snapshot('2026-09-17', { JPY: 100, CNY: 10000 }, null), snapshot('2026-09-18', { JPY: 200, CNY: 10000 })]))
  assert.match(total, /区间净变化 <strong class="money">待汇率<\/strong>/)
  assert.match(total, /d=" M 302 75"/)
  assert.match(native, /d="M 18 130 L 302 20"/)
  const unavailable = panels(render([snapshot('2026-09-18', { JPY: 100, CNY: 10000 }, null)]))
  assert.ok(!unavailable[0].includes('<svg'))
  assert.ok(unavailable[1].includes('<svg'))
})

test('history keeps gaps and handles flat, negative and empty balances', () => {
  const [gapped] = panels(render([snapshot('2026-09-16', { JPY: 100, CNY: 10000 }), snapshot('2026-09-17', { JPY: 100, CNY: 10000 }, null), snapshot('2026-09-18', { JPY: 200, CNY: 10000 })]))
  assert.match(gapped, /d="M 18 130  M 302 20"/)
  const [negative] = panels(render([snapshot('2026-09-17', { JPY: -100, CNY: 0 }), snapshot('2026-09-18', { JPY: -200, CNY: 0 })]))
  assert.match(negative, /d="M 18 20 L 302 130"/)
  assert.ok(negative.includes(money(-100, 'JPY')))
  for (const value of [0, -100]) {
    const html = render([snapshot('2026-09-18', { JPY: value, CNY: 0 })])
    assert.match(html, /d="M 18 75"/)
    assert.ok(!/NaN|Infinity/.test(html))
  }
  assert.equal(panels(render([])).length, 0)
})

test('history correction identifies the real snapshot date and explains current balance effects', () => {
  const asset: Asset = { id: 'one', source: '银行账户', currency: 'JPY', amountMinor: 100, updatedDay: '2026-09-17', updatedAt: '2026-09-17T00:00:00Z' }
  const html = render([{ ...snapshot('2026-09-17', { JPY: 100, CNY: 0 }), assets: [asset] }])
  assert.ok(html.includes('修改历史金额'))
  assert.ok(html.includes('修改 2026-09-17 快照'))
  assert.ok(!html.includes('修改 2026-09-18 快照'))
  assert.ok(html.includes('更新为今日余额'))
  for (const affectsCurrent of [true, false]) {
    const editor = renderToStaticMarkup(createElement(AssetEditor, {
      asset, history: { day: '2026-09-17', through: '2026-09-18', affectsCurrent }, currency: 'JPY',
      onClose: () => {}, onSave: async () => {}, onDelete: async () => {},
    }))
    assert.ok(editor.includes('修正历史金额'))
    assert.ok(editor.includes('2026-09-17 的余额'))
    assert.ok(editor.includes('readOnly=""'))
    assert.ok(editor.includes('保存历史修正'))
    assert.ok(!editor.includes('删除这条资产'))
    assert.ok(editor.includes(affectsCurrent ? '当前资产余额也会同步修正' : '当前资产余额保持不变'))
  }
})
