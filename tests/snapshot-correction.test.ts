import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LEDGER, convertedTotal, correctSnapshotAmount, historyBetween, recordSnapshot, removeAsset, saveAsset } from '../src/domain/ledger.ts'
import type { Rate } from '../src/domain/ledger.ts'
import { exportBackup, parseBackup } from '../src/services/backup.ts'

const first = new Date(2026, 8, 15, 12)
const now = new Date(2026, 8, 18, 12)
const rate: Rate = { cnyToJpy: 20, date: '2026-09-15', fetchedAt: first.toISOString(), source: 'Frankfurter' }
function create() {
  const ledger = saveAsset(EMPTY_LEDGER, { source: '日元账户', currency: 'JPY', amount: '1000' }, rate, first, 'jpy')
  return saveAsset(ledger, { source: '人民币账户', currency: 'CNY', amount: '100' }, rate, first, 'cny')
}

test('correcting an older snapshot changes only its selected amount and recomputes totals with the original rate', () => {
  const original = saveAsset(create(), { id: 'cny', source: '人民币账户', currency: 'CNY', amount: '300' }, { ...rate, cnyToJpy: 21 }, now)
  const before = structuredClone(original)
  const changed = correctSnapshotAmount(original, '2026-09-15', 'cny', '200', now)
  assert.deepEqual(original, before)
  assert.equal(changed.revision, original.revision + 1)
  assert.deepEqual(changed.snapshots[0].totals, { JPY: 1000, CNY: 20000 })
  assert.equal(convertedTotal(changed.snapshots[0].totals, 'JPY', changed.snapshots[0].rate), 5000)
  assert.equal(convertedTotal(changed.snapshots[0].totals, 'CNY', changed.snapshots[0].rate), 25000)
  assert.deepEqual(changed.snapshots[0].rate, rate)
  assert.deepEqual(changed.snapshots[0].assets[0], original.snapshots[0].assets[0])
  assert.equal(changed.snapshots[0].assets[1].updatedDay, '2026-09-15')
  assert.equal(changed.snapshots[0].savedAt, now.toISOString())
  assert.deepEqual(changed.snapshots[1], original.snapshots[1])
  assert.deepEqual(changed.assets, original.assets)
  assert.deepEqual(historyBetween(changed.snapshots, '2026-09-15', '2026-09-18').map(point => point.snapshot.totals.CNY), [20000, 20000, 20000, 30000])
  assert.deepEqual(parseBackup(exportBackup(changed), '2026-09-18').snapshots, changed.snapshots)
})

test('correcting the latest snapshot synchronizes current balances without creating a new date', () => {
  const original = create()
  const changed = correctSnapshotAmount(original, '2026-09-15', 'jpy', '-500', now)
  assert.equal(changed.snapshots.length, 1)
  assert.deepEqual(changed.assets, changed.snapshots[0].assets)
  assert.equal(changed.assets[0].amountMinor, -500)
  assert.equal(changed.assets[1].amountMinor, 10000)
  assert.ok(historyBetween(changed.snapshots, '2026-09-15', '2026-09-18').every(point => point.snapshot.totals.JPY === -500))
  assert.deepEqual(parseBackup(exportBackup(changed), '2026-09-18').assets, changed.assets)
  const today = recordSnapshot(original, original.assets, rate, now)
  assert.equal(correctSnapshotAmount(today, '2026-09-18', 'jpy', '0', now).assets[0].amountMinor, 0)
})

test('historical correction does not restore an asset removed from current balances', () => {
  const original = removeAsset(create(), 'cny', rate, now)
  const changed = correctSnapshotAmount(original, '2026-09-15', 'cny', '200', now)
  assert.deepEqual(changed.assets, original.assets)
  assert.equal(changed.snapshots[0].totals.CNY, 20000)
  assert.equal(changed.snapshots[1].totals.CNY, 0)
})

test('historical correction preserves missing rates and accepts zero and negative CNY amounts', () => {
  const original = recordSnapshot(create(), create().assets, null, first)
  for (const amount of ['0', '-50']) {
    const changed = correctSnapshotAmount(original, '2026-09-15', 'cny', amount, now)
    assert.equal(changed.snapshots[0].rate, null)
    assert.equal(changed.snapshots[0].totals.CNY, Number(amount) * 100)
    assert.equal(convertedTotal(changed.snapshots[0].totals, 'CNY', null), null)
    assert.deepEqual(parseBackup(exportBackup(changed), '2026-09-18').snapshots, changed.snapshots)
  }
})

test('invalid corrections cannot mutate data or create a snapshot for a carried date', () => {
  const original = create()
  const before = structuredClone(original)
  for (const day of ['2026-02-30', '2026-09-16', '2026-09-19']) assert.throws(() => correctSnapshotAmount(original, day, 'cny', '200', now))
  assert.throws(() => correctSnapshotAmount(original, '2026-09-15', 'missing', '200', now))
  for (const amount of ['', '1.25', 'not a number', '900000001']) assert.throws(() => correctSnapshotAmount(original, '2026-09-15', 'cny', amount, now))
  assert.deepEqual(original, before)
})
