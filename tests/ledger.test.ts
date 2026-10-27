import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LEDGER, amountInput, convertedTotal, historyBetween, parseAmount, recordSnapshot, removeAsset, resetHistory, saveAsset, sumAssets } from '../src/domain/ledger.ts'
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
test('history includes saved dates only, preserving their amounts and rates', () => {
  const points = historyBetween(create().snapshots, '2026-09-13', '2026-09-17')
  assert.deepEqual(points.map(p => p.day), ['2026-09-15'])
  assert.ok(points.every(p => convertedTotal(p.snapshot.totals, 'JPY', p.snapshot.rate) === 2005))
})
test('deletion saves a zero balance without creating subsequent history', () => {
  const changed = removeAsset(create(), 'one', rate, second)
  assert.equal(changed.assets.length, 0)
  assert.equal(changed.snapshots[0].assets.length, 1)
  assert.equal(changed.snapshots[1].totals.CNY, 0)
  assert.deepEqual(historyBetween(changed.snapshots, '2026-09-17', '2026-09-17'), [])
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

test('backup round trips preserve only saved dates across one-day and multi-day gaps', () => {
  const original = create()
  const third = new Date(2026, 8, 17, 12)
  const seventh = new Date(2026, 8, 21, 12)
  // Saving an unchanged balance is still a real record, including a rate refresh.
  const middle = recordSnapshot(original, original.assets, rate, third)
  const ledger = recordSnapshot(middle, middle.assets, rate, seventh)
  const before = structuredClone(ledger)
  const days = ['2026-09-15', '2026-09-17', '2026-09-21']
  // This is also the schema used by backups produced before 2.5.0.
  const legacy = JSON.stringify({ app: 'my-assets', schemaVersion: 1, exportedAt: seventh.toISOString(), data: ledger })
  let restored = parseBackup(legacy, '2026-09-25')
  for (let pass = 0; pass < 2; pass++) {
    const text = exportBackup(restored)
    assert.deepEqual(JSON.parse(text).data.snapshots.map((s: { day: string }) => s.day), days)
    restored = parseBackup(text, '2026-09-25')
    assert.deepEqual(restored.snapshots, ledger.snapshots)
    assert.deepEqual(historyBetween(restored.snapshots, '2026-09-01', '2026-09-25').map(point => point.day), days)
    assert.deepEqual(historyBetween(restored.snapshots, '2026-09-18', '2026-09-20'), [])
  }
  assert.deepEqual(ledger, before)
})

test('reset removes old snapshots and starts today from unchanged current balances', () => {
  const original = saveAsset(create(), { id: 'one', source: '自己填写的来源', currency: 'CNY', amount: '200' }, rate, second)
  const before = structuredClone(original)
  const now = new Date(2026, 8, 21, 12)
  const reset = resetHistory(original, rate, now)
  assert.equal(reset.revision, original.revision + 1)
  assert.deepEqual(reset.assets, original.assets)
  assert.deepEqual(reset.snapshots.map(snapshot => snapshot.day), ['2026-09-21'])
  assert.deepEqual(reset.snapshots[0].assets, original.assets)
  assert.deepEqual(reset.snapshots[0].totals, sumAssets(original.assets))
  assert.deepEqual(parseBackup(exportBackup(reset), '2026-09-21').snapshots, reset.snapshots)
  assert.deepEqual(original, before)
  const next = saveAsset(reset, { id: 'one', source: '自己填写的来源', currency: 'CNY', amount: '250' }, rate, new Date(2026, 8, 22, 12))
  assert.deepEqual(next.snapshots.map(snapshot => snapshot.day), ['2026-09-21', '2026-09-22'])
})

test('resetting an empty current balance still yields a valid zero baseline', () => {
  const removed = removeAsset(create(), 'one', rate, second)
  const reset = resetHistory(removed, null, new Date(2026, 8, 21, 12))
  assert.deepEqual(reset.assets, [])
  assert.deepEqual(reset.snapshots.map(snapshot => snapshot.day), ['2026-09-21'])
  assert.deepEqual(reset.snapshots[0].totals, { JPY: 0, CNY: 0 })
  assert.deepEqual(parseBackup(exportBackup(reset), '2026-09-21').snapshots, reset.snapshots)
})

test('saved history sorts without mutation and does not fill empty or invalid ranges', () => {
  const original = create()
  const later = recordSnapshot(original, original.assets, rate, new Date(2026, 8, 21, 12))
  const unordered = [...later.snapshots].reverse()
  const before = structuredClone(unordered)
  assert.deepEqual(historyBetween(unordered, '2026-09-01', '2026-09-25').map(p => p.day), ['2026-09-15', '2026-09-21'])
  assert.deepEqual(unordered, before)
  for (const [from, to] of [['2026-09-16', '2026-09-20'], ['2026-09-22', '2026-09-25'], ['invalid', '2026-09-25'], ['2026-09-25', '2026-09-01']]) {
    assert.deepEqual(historyBetween(unordered, from, to), [])
  }
  assert.deepEqual(historyBetween([], '2026-09-01', '2026-09-25'), [])
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

test('refreshing on a new day saves today without filling gaps or repricing older records', () => {
  const original = create()
  const third = new Date(2026, 8, 17, 12)
  const refreshed = recordSnapshot(original, original.assets, { ...rate, cnyToJpy: 21, fetchedAt: third.toISOString() }, third)
  const points = historyBetween(refreshed.snapshots, '2026-09-15', '2026-09-17')
  assert.deepEqual(points.map(point => point.snapshot.rate?.cnyToJpy), [20, 21])
  assert.deepEqual(points.map(point => point.day), ['2026-09-15', '2026-09-17'])
  assert.equal(refreshed.snapshots.at(-1)?.day, '2026-09-17')
  assert.deepEqual(refreshed.assets, original.assets)
  assert.deepEqual(refreshed.snapshots[0], original.snapshots[0])
})
