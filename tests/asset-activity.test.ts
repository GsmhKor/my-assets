import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetUpdateFrequency, resolveAssetActivity } from '../src/domain/assetActivity.ts'
import { sortAssets } from '../src/domain/assetSort.ts'
import { EMPTY_LEDGER, correctSnapshotAmount, ensureDailySnapshot, recordSnapshot, removeAsset, resetHistory, saveAsset } from '../src/domain/ledger.ts'
import type { Draft, Ledger } from '../src/domain/ledger.ts'
import { exportBackup, parseBackup } from '../src/services/backup.ts'

const date = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`)
const draft: Draft = { source: '零钱', currency: 'JPY', amount: '100' }

test('every same-day balance change counts immediately, without counting duplicate saves or renames', () => {
  const created = saveAsset(EMPTY_LEDGER, draft, null, date('2026-09-01'), 'cash')
  const before = structuredClone(created)
  const changed = saveAsset(created, { ...draft, id: 'cash', amount: '200' }, null, date('2026-09-01', 13))
  assert.equal(assetUpdateFrequency(changed.assetActivity?.cash, '2026-09-01'), 2)
  assert.equal(changed.snapshots.length, 1)
  const unchanged = saveAsset(changed, { ...draft, id: 'cash', amount: '200' }, null, date('2026-09-01', 14))
  const renamed = saveAsset(unchanged, { ...draft, id: 'cash', source: '新零钱', amount: '200' }, null, date('2026-09-01', 15))
  assert.deepEqual(renamed.assetActivity, changed.assetActivity)
  const currencyChanged = saveAsset(renamed, { ...draft, id: 'cash', currency: 'CNY', amount: '2' }, null, date('2026-09-01', 16))
  assert.equal(assetUpdateFrequency(currencyChanged.assetActivity?.cash, '2026-09-01'), 3)
  assert.deepEqual(created, before)
})

test('new accounts overtake infrequently used accounts as soon as a balance is updated', () => {
  let ledger = saveAsset(EMPTY_LEDGER, { ...draft, source: '银行' }, null, date('2026-09-01'), 'bank')
  ledger = saveAsset(ledger, draft, null, date('2026-09-02'), 'cash')
  ledger = saveAsset(ledger, { ...draft, source: '银行', id: 'bank', amount: '101' }, null, date('2026-09-02', 13))
  assert.deepEqual(sortAssets(ledger.assets, 'default', ledger.assetActivity, '2026-09-02').map(asset => asset.id), ['bank', 'cash'])
  ledger = saveAsset(ledger, { ...draft, id: 'cash', amount: '99' }, null, date('2026-09-02', 14))
  assert.deepEqual(sortAssets(ledger.assets, 'default', ledger.assetActivity, '2026-09-02').map(asset => asset.id), ['cash', 'bank'])
})

test('the rolling window includes today and the preceding 29 calendar days, and caps the denominator at 30', () => {
  const activity = { createdDay: '2026-08-01', updates: [
    { day: '2026-09-01', count: 100 }, { day: '2026-09-02', count: 2 }, { day: '2026-10-01', count: 1 }, { day: '2026-10-02', count: 100 },
  ] }
  assert.equal(assetUpdateFrequency(activity, '2026-10-01'), 3 / 30)
  assert.equal(assetUpdateFrequency({ createdDay: '2026-09-30', updates: [{ day: '2026-09-30', count: 2 }] }, '2026-10-01'), 1)
  const ledger = saveAsset(EMPTY_LEDGER, draft, null, date('2026-09-01'), 'cash')
  const changed = saveAsset(ledger, { ...draft, id: 'cash', amount: '200' }, null, date('2026-10-01'))
  assert.deepEqual(changed.assetActivity?.cash, { createdDay: '2026-09-01', updates: [{ day: '2026-10-01', count: 1 }] })
})

test('daily snapshots, rate refreshes, historical corrections and history resets preserve counters', () => {
  const ledger = saveAsset(EMPTY_LEDGER, draft, null, date('2026-09-01'), 'cash')
  const daily = ensureDailySnapshot(ledger, null, date('2026-09-02'))
  const refreshed = recordSnapshot(daily, daily.assets, { cnyToJpy: 20, date: '2026-09-02', fetchedAt: date('2026-09-02').toISOString(), source: '手动' }, date('2026-09-02'))
  const correctedOlder = correctSnapshotAmount(refreshed, '2026-09-01', 'cash', '500', date('2026-09-02'))
  const correctedLatest = correctSnapshotAmount(correctedOlder, '2026-09-02', 'cash', '600', date('2026-09-02'))
  const reset = resetHistory(correctedLatest, null, date('2026-09-03'))
  for (const result of [daily, refreshed, correctedOlder, correctedLatest, reset]) assert.deepEqual(result.assetActivity, ledger.assetActivity)
  assert.deepEqual(removeAsset(reset, 'cash', null, date('2026-09-03')).assetActivity, {})
})

test('legacy data derives observable changes once and preserves that baseline when history is reset or corrected', () => {
  let legacy = saveAsset(EMPTY_LEDGER, draft, null, date('2026-09-01'), 'cash')
  legacy = ensureDailySnapshot(legacy, null, date('2026-09-02'))
  legacy = saveAsset(legacy, { ...draft, id: 'cash', amount: '200' }, null, date('2026-09-03'))
  delete legacy.assetActivity
  const before = structuredClone(legacy)
  const expected = { cash: { createdDay: '2026-09-01', updates: [{ day: '2026-09-01', count: 1 }, { day: '2026-09-03', count: 1 }] } }
  assert.deepEqual(resolveAssetActivity(legacy, '2026-09-03'), expected)
  assert.deepEqual(resetHistory(legacy, null, date('2026-09-03')).assetActivity, expected)
  assert.deepEqual(correctSnapshotAmount(legacy, '2026-09-01', 'cash', '300', date('2026-09-03')).assetActivity, expected)
  const updated = saveAsset(legacy, { ...draft, id: 'cash', amount: '400' }, null, date('2026-09-03', 13))
  assert.deepEqual(updated.assetActivity?.cash.updates, [{ day: '2026-09-01', count: 1 }, { day: '2026-09-03', count: 2 }])
  assert.deepEqual(legacy, before)
})

test('backup round trips preserve hidden counters and accept legacy backups', () => {
  let ledger = saveAsset(EMPTY_LEDGER, draft, null, date('2026-09-01'), 'cash')
  ledger = saveAsset(ledger, { ...draft, id: 'cash', amount: '200' }, null, date('2026-09-01', 13))
  const restored = parseBackup(exportBackup(ledger), '2026-09-01')
  assert.deepEqual(restored.assetActivity, ledger.assetActivity)
  assert.equal(assetUpdateFrequency(restored.assetActivity?.cash, '2026-09-01'), 2)
  const legacy: Ledger = { revision: ledger.revision, assets: ledger.assets, snapshots: ledger.snapshots }
  assert.equal(parseBackup(exportBackup(legacy), '2026-09-01').assetActivity, undefined)
  const invalid = [
    { createdDay: '2026-09-02', updates: [] },
    { createdDay: '2026-09-01', updates: [{ day: '2026-09-01', count: -1 }] },
    { createdDay: '2026-09-01', updates: [{ day: '2026-09-02', count: 1 }] },
    { createdDay: '2026-09-01', updates: [{ day: '2026-08-31', count: 1 }] },
    { createdDay: '2026-09-01', updates: [{ day: '2026-09-01', count: 1.5 }] },
    { createdDay: '2026-09-01', updates: [{ day: '2026-09-01', count: 1 }, { day: '2026-09-01', count: 1 }] },
  ]
  for (const activity of invalid) {
    const backup = JSON.parse(exportBackup(ledger))
    backup.data.assetActivity.cash = activity
    assert.throws(() => parseBackup(JSON.stringify(backup), '2026-09-01'))
  }
  const missing = JSON.parse(exportBackup(ledger))
  missing.data.assetActivity.missing = missing.data.assetActivity.cash
  assert.throws(() => parseBackup(JSON.stringify(missing), '2026-09-01'))
})
