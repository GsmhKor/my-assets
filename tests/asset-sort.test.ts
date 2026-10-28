import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Currency } from '../src/domain/ledger.ts'
import { assetSortPreference, sortAssets } from '../src/domain/assetSort.ts'

const asset = (id: string, source: string, currency: Currency, amountMinor: number): Asset => ({
  id, source, currency, amountMinor, updatedDay: '2026-09-26', updatedAt: '2026-09-26T00:00:00Z',
})
const ids = (assets: Asset[]) => assets.map(item => item.id)

test('missing and legacy default preferences select pinyin ascending', () => {
  assert.equal(assetSortPreference('default'), 'asc')
  assert.equal(assetSortPreference('invalid'), 'asc')
  assert.equal(assetSortPreference('asc'), 'asc')
  assert.equal(assetSortPreference('desc'), 'desc')
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
