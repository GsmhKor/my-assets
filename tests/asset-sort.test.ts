import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Currency } from '../src/domain/ledger.ts'
import { assetSortPreference, nextAssetSort, sortAssets } from '../src/domain/assetSort.ts'
import type { AssetActivity } from '../src/domain/assetActivity.ts'

const asset = (id: string, source: string, currency: Currency, amountMinor: number): Asset => ({
  id, source, currency, amountMinor, updatedDay: '2026-09-26', updatedAt: '2026-09-26T00:00:00Z',
})
const ids = (assets: Asset[]) => assets.map(item => item.id)

test('default and unknown preferences select frequency sorting; the button cycles through all three modes', () => {
  assert.equal(assetSortPreference('default'), 'default')
  assert.equal(assetSortPreference('invalid'), 'default')
  assert.equal(assetSortPreference(''), 'default')
  assert.equal(assetSortPreference('asc'), 'asc')
  assert.equal(assetSortPreference('desc'), 'desc')
  assert.equal(nextAssetSort('default'), 'asc')
  assert.equal(nextAssetSort('asc'), 'desc')
  assert.equal(nextAssetSort('desc'), 'default')
})

test('name ordering follows Chinese pinyin in both directions, independent of currency and amount', () => {
  const assets = [
    asset('yin', '银行', 'JPY', -99999),
    asset('zhong', '中信', 'CNY', 10000),
    asset('ai', '爱心', 'JPY', 1),
    asset('bei', '北京', 'CNY', -10000),
  ]
  const original = structuredClone(assets)
  assert.deepEqual(ids(sortAssets(assets, 'asc')), ['ai', 'bei', 'yin', 'zhong'])
  assert.deepEqual(ids(sortAssets(assets, 'desc')), ['zhong', 'yin', 'bei', 'ai'])
  assert.deepEqual(assets, original)
})

test('default sorting puts two first-day updates ahead of a bank used fifteen times in thirty days', () => {
  const assets = [asset('bank', '银行', 'JPY', 99999), asset('new', '新账户', 'CNY', 1), asset('cash', '零钱', 'JPY', 100)]
  const activities: Record<string, AssetActivity> = {
    bank: { createdDay: '2026-08-01', updates: [{ day: '2026-09-26', count: 15 }] },
    new: { createdDay: '2026-09-26', updates: [{ day: '2026-09-26', count: 2 }] },
    cash: { createdDay: '2026-08-01', updates: [{ day: '2026-09-26', count: 90 }] },
  }
  const before = structuredClone({ assets, activities })
  assert.deepEqual(ids(sortAssets(assets, 'default', activities, '2026-09-26')), ['cash', 'new', 'bank'])
  assert.deepEqual({ assets, activities }, before)
})

test('equal frequencies use the latest update, then pinyin, then a stable ID', () => {
  const assets = [asset('yin', '银行', 'JPY', 1), asset('bei', '北京', 'CNY', 2), { ...asset('late', '最后', 'JPY', 3), updatedAt: '2026-09-26T01:00:00Z' }]
  assert.deepEqual(ids(sortAssets(assets, 'default', {}, '2026-09-26')), ['late', 'bei', 'yin'])
})
