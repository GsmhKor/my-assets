import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LEDGER, amountInput, convertedTotal, correctSnapshotAmount, historyBetween, parseAmount, recordSnapshot, removeAsset, saveAsset, sumAssets } from '../src/domain/ledger.ts'
import type { Asset, Rate } from '../src/domain/ledger.ts'
import { exportBackup, parseBackup } from '../src/services/backup.ts'

const first = new Date(2026, 8, 15, 12)
const second = new Date(2026, 8, 16, 12)
const rate: Rate = { cnyToJpy: 20, date: '2026-09-15', fetchedAt: first.toISOString(), source: 'Frankfurter' }
// Legacy fractional balances remain compatible with stored snapshots and backups.
const create = () => {
  const asset: Asset = { id: 'one', source: '自己填写的来源', currency: 'CNY', amountMinor: 10025, updatedDay: '2026-09-15', updatedAt: first.toISOString() }
  return recordSnapshot(EMPTY_LEDGER, [asset], rate, first)
}

test('negative balances, precision and two-way conversion', () => {
  assert.equal(parseAmount('-100', 'CNY'), -10000)
  assert.equal(parseAmount('100', 'CNY'), 10000)
  assert.equal(parseAmount('0', 'CNY'), 0)
  assert.equal(parseAmount('-2000', 'JPY'), -2000)
  assert.throws(() => parseAmount('1.1', 'JPY'))
  assert.throws(() => parseAmount('1.001', 'CNY'))
  assert.throws(() => parseAmount('1.25', 'CNY'))
  assert.throws(() => parseAmount('1.00', 'CNY'))
  assert.equal(convertedTotal({ JPY: -1000, CNY: 10025 }, 'JPY', rate), 1005)
  assert.equal(convertedTotal({ JPY: -1000, CNY: 10025 }, 'CNY', rate), 5025)
  assert.equal(convertedTotal({ JPY: -1, CNY: 0 }, 'CNY', { ...rate, cnyToJpy: 200 }), -1)
  assert.equal(convertedTotal({ JPY: 1, CNY: 100 }, 'JPY', null), null)
  assert.equal(convertedTotal({ JPY: -1000, CNY: 0 }, 'JPY', null), -1000)
})

test('editing legacy CNY rounds to whole yuan and saves without changing previous history', () => {
  for (const [minor, expected] of [[10049, '100'], [10050, '101'], [-10049, '-100'], [-10050, '-101']] as const) {
    const asset = { ...create().assets[0], amountMinor: minor }
    const original = recordSnapshot(EMPTY_LEDGER, [asset], rate, first)
    const amount = amountInput(asset)
    assert.equal(amount, expected)
    const changed = saveAsset(original, { id: asset.id, source: asset.source, currency: 'CNY', amount }, rate, second)
    assert.equal(changed.assets[0].amountMinor, Number(expected) * 100)
    assert.equal(changed.snapshots[0].assets[0].amountMinor, minor)
    assert.deepEqual(parseBackup(exportBackup(changed), '2026-09-16').snapshots, changed.snapshots)
  }
  assert.throws(() => saveAsset(EMPTY_LEDGER, { source: 'New account', currency: 'CNY', amount: '100.25' }, rate, first, 'new'))
})
test('editing replaces balance, dates it today, and preserves older snapshots', () => {
  const original = create()
  const changed = saveAsset(original, { id: 'one', source: '自己填写的来源', currency: 'CNY', amount: '-50' }, { ...rate, cnyToJpy: 21 }, second)
  assert.equal(changed.assets.length, 1)
  assert.equal(changed.assets[0].updatedDay, '2026-09-16')
  assert.equal(changed.snapshots[0].totals.CNY, 10025)
  assert.equal(changed.snapshots[0].rate?.cnyToJpy, 20)
  assert.equal(changed.snapshots[1].totals.CNY, -5000)
  assert.equal(original.assets[0].amountMinor, 10025)
})
test('one final snapshot per day; duplicate sources per currency are prevented', () => {
  const original = create()
  const changed = saveAsset(original, { id: 'one', source: '自己填写的来源', currency: 'CNY', amount: '200' }, rate, first)
  assert.equal(changed.snapshots.length, 1)
  assert.equal(changed.snapshots[0].totals.CNY, 20000)
  assert.throws(() => saveAsset(original, { source: ' 自己填写的来源 ', currency: 'CNY', amount: '1' }, rate, first))
  assert.equal(saveAsset(original, { source: '自己填写的来源', currency: 'JPY', amount: '1' }, rate, first).assets.length, 2)
})
test('missing days carry saved total AND saved rate, before first record stays empty', () => {
  const points = historyBetween(create().snapshots, '2026-09-13', '2026-09-17')
  assert.deepEqual(points.map(p => p.day), ['2026-09-15', '2026-09-16', '2026-09-17'])
  assert.deepEqual(points.map(p => p.carried), [false, true, true])
  assert.ok(points.every(p => convertedTotal(p.snapshot.totals, 'JPY', p.snapshot.rate) === 2005))
})
test('deletion changes today only, and zero carries to subsequent days', () => {
  const changed = removeAsset(create(), 'one', rate, second)
  assert.equal(changed.assets.length, 0)
  assert.equal(changed.snapshots[0].assets.length, 1)
  assert.equal(historyBetween(changed.snapshots, '2026-09-17', '2026-09-17')[0].snapshot.totals.CNY, 0)
})
test('backup restores data and rejects incorrect totals or other app formats', () => {
  const original = create()
  const text = exportBackup(original)
  assert.deepEqual(parseBackup(text, '2026-09-17').snapshots, original.snapshots)
  const broken = JSON.parse(text)
  broken.data.snapshots[0].totals.CNY = 1
  assert.throws(() => parseBackup(JSON.stringify(broken), '2026-09-17'))
  assert.throws(() => parseBackup(text.replace('my-assets', 'my-ledger'), '2026-09-17'))
})

test('refreshing a rate replaces only today and keeps current balances unchanged', () => {
  const original = saveAsset(create(), { source: 'JPY account', currency: 'JPY', amount: '1000' }, rate, second, 'two')
  const before = structuredClone(original)
  const freshRate: Rate = { ...rate, cnyToJpy: 21, date: '2026-09-16', fetchedAt: second.toISOString() }
  const refreshed = recordSnapshot(original, original.assets, freshRate, second)
  assert.equal(refreshed.snapshots.length, 2)
  assert.deepEqual(refreshed.snapshots[0], before.snapshots[0])
  assert.deepEqual(refreshed.assets, before.assets)
  assert.deepEqual(original, before)
  const today = refreshed.snapshots.at(-1)!
  assert.equal(today.rate?.cnyToJpy, 21)
  assert.equal(convertedTotal(today.totals, 'JPY', today.rate), 3105)
  assert.equal(convertedTotal(today.totals, 'CNY', today.rate), 14787)
  for (const currency of ['JPY', 'CNY'] as const) {
    assert.equal(convertedTotal(today.totals, currency, today.rate), convertedTotal(sumAssets(refreshed.assets), currency, freshRate))
  }
  assert.deepEqual(parseBackup(exportBackup(refreshed), '2026-09-16').snapshots, refreshed.snapshots)
  const again = recordSnapshot(refreshed, refreshed.assets, { ...freshRate, cnyToJpy: 22 }, second)
  assert.equal(again.snapshots.length, 2)
  assert.equal(again.snapshots.at(-1)?.rate?.cnyToJpy, 22)
  assert.deepEqual(again.snapshots[0], before.snapshots[0])
})

test('refreshing on a new day creates today without repricing previous carried days', () => {
  const original = create()
  const third = new Date(2026, 8, 17, 12)
  const refreshed = recordSnapshot(original, original.assets, { ...rate, cnyToJpy: 21, fetchedAt: third.toISOString() }, third)
  const points = historyBetween(refreshed.snapshots, '2026-09-15', '2026-09-17')
  assert.deepEqual(points.map(point => point.snapshot.rate?.cnyToJpy), [20, 20, 21])
  assert.deepEqual(points.map(point => point.carried), [false, true, false])
  assert.equal(refreshed.snapshots.at(-1)?.day, '2026-09-17')
  assert.deepEqual(refreshed.assets, original.assets)
  assert.deepEqual(refreshed.snapshots[0], original.snapshots[0])
})

test('correcting an older snapshot recalculates totals with its saved rate without rewriting later balances', () => {
  const withJpy = saveAsset(create(), { source: 'JPY account', currency: 'JPY', amount: '1000' }, rate, first, 'two')
  const original = saveAsset(withJpy, { id: 'one', source: '自己填写的来源', currency: 'CNY', amount: '300' }, { ...rate, cnyToJpy: 21 }, second)
  const before = structuredClone(original)
  const corrected = correctSnapshotAmount(original, '2026-09-15', 'one', '200', second)
  assert.deepEqual(original, before)
  assert.equal(corrected.revision, original.revision + 1)
  assert.deepEqual(corrected.snapshots[0].totals, { JPY: 1000, CNY: 20000 })
  assert.equal(convertedTotal(corrected.snapshots[0].totals, 'JPY', corrected.snapshots[0].rate), 5000)
  assert.deepEqual(corrected.snapshots[0].rate, rate)
  assert.deepEqual(corrected.snapshots[0].assets[1], original.snapshots[0].assets[1])
  assert.equal(corrected.snapshots[0].assets[0].updatedDay, '2026-09-15')
  assert.equal(corrected.snapshots[0].savedAt, second.toISOString())
  assert.deepEqual(corrected.snapshots[1], original.snapshots[1])
  assert.deepEqual(corrected.assets, original.assets)
  assert.deepEqual(parseBackup(exportBackup(corrected), '2026-09-16').snapshots, corrected.snapshots)
})

test('correcting the latest snapshot synchronizes current assets and carried days, including negative JPY', () => {
  const original = saveAsset(create(), { source: 'JPY account', currency: 'JPY', amount: '1000' }, rate, first, 'two')
  const corrected = correctSnapshotAmount(original, '2026-09-15', 'two', '-500', second)
  assert.equal(corrected.snapshots.length, 1)
  assert.deepEqual(corrected.assets, corrected.snapshots[0].assets)
  assert.equal(corrected.assets[1].amountMinor, -500)
  assert.equal(corrected.assets[0].amountMinor, 10025)
  assert.ok(historyBetween(corrected.snapshots, '2026-09-15', '2026-09-16').every(point => point.snapshot.totals.JPY === -500))
  assert.deepEqual(parseBackup(exportBackup(corrected), '2026-09-16').assets, corrected.assets)
})

test('historical corrections stop at the next saved snapshot and do not restore a deleted current asset', () => {
  const third = new Date(2026, 8, 17, 12)
  const original = removeAsset(create(), 'one', rate, third)
  const corrected = correctSnapshotAmount(original, '2026-09-15', 'one', '200', third)
  const points = historyBetween(corrected.snapshots, '2026-09-15', '2026-09-17')
  assert.deepEqual(points.map(point => point.snapshot.totals.CNY), [20000, 20000, 0])
  assert.deepEqual(corrected.assets, [])
  assert.deepEqual(corrected.snapshots[1], original.snapshots[1])
})

test('corrections without a historical rate preserve missing conversion and accept zero', () => {
  const original = recordSnapshot(create(), create().assets, null, first)
  const corrected = correctSnapshotAmount(original, '2026-09-15', 'one', '200', second)
  assert.equal(corrected.snapshots[0].rate, null)
  assert.equal(convertedTotal(corrected.snapshots[0].totals, 'JPY', null), null)
  assert.equal(correctSnapshotAmount(corrected, '2026-09-15', 'one', '0', second).snapshots[0].totals.CNY, 0)
})

test('historical corrections reject invalid dates, missing records and invalid amounts without mutations', () => {
  const original = create()
  const before = structuredClone(original)
  for (const day of ['2026-02-30', '2026-09-16', '2026-09-17']) assert.throws(() => correctSnapshotAmount(original, day, 'one', '200', second))
  assert.throws(() => correctSnapshotAmount(original, '2026-09-15', 'missing', '200', second))
  for (const amount of ['', '1.25', 'not a number', '900000001']) assert.throws(() => correctSnapshotAmount(original, '2026-09-15', 'one', amount, second))
  assert.deepEqual(original, before)
})
