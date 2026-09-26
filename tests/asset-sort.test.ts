import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Currency, Rate } from '../src/domain/ledger.ts'
import { sortAssetsByAmount } from '../src/domain/assetSort.ts'

const rate: Rate = { cnyToJpy: 20, date: '2026-09-26', fetchedAt: '2026-09-26T00:00:00Z', source: 'Frankfurter' }
const asset = (id: string, currency: Currency, amountMinor: number): Asset => ({ id, source: id, currency, amountMinor, updatedDay: '2026-09-26', updatedAt: '2026-09-26T00:00:00Z' })
const ids = (assets: Asset[]) => assets.map(asset => asset.id)

test('sorts mixed currencies by converted value, from positive through zero to negative or in reverse', () => {
  const assets = [asset('jpy-debt', 'JPY', -1000), asset('jpy', 'JPY', 1000), asset('cny', 'CNY', 10000), asset('zero', 'CNY', 0), asset('cny-debt', 'CNY', -10000)]
  const original = structuredClone(assets)
  const expected = ['cny', 'jpy', 'zero', 'jpy-debt', 'cny-debt']
  assert.deepEqual(ids(sortAssetsByAmount(assets, 'desc', rate)), expected)
  assert.deepEqual(ids(sortAssetsByAmount(assets, 'asc', rate)), expected.toReversed())
  assert.deepEqual(assets, original)
})

test('uses the supplied rate without rounding away small differences', () => {
  const assets = [asset('yen', 'JPY', 1), asset('yuan', 'CNY', 6)]
  assert.deepEqual(ids(sortAssetsByAmount(assets, 'desc', rate)), ['yuan', 'yen'])
  assert.deepEqual(ids(sortAssetsByAmount(assets, 'desc', { ...rate, cnyToJpy: 10 })), ['yen', 'yuan'])
})

test('groups currencies without a usable rate and sorts each group in the selected direction', () => {
  const assets = [asset('cny-low', 'CNY', -10000), asset('jpy-low', 'JPY', -100), asset('cny-high', 'CNY', 10000), asset('jpy-high', 'JPY', 100)]
  for (const unavailable of [null, { ...rate, cnyToJpy: 0 }]) {
    assert.deepEqual(ids(sortAssetsByAmount(assets, 'desc', unavailable)), ['jpy-high', 'jpy-low', 'cny-high', 'cny-low'])
    assert.deepEqual(ids(sortAssetsByAmount(assets, 'asc', unavailable)), ['jpy-low', 'jpy-high', 'cny-low', 'cny-high'])
  }
})
