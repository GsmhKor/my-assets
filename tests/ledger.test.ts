import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LEDGER, convertedTotal, historyBetween, parseAmount, removeAsset, saveAsset } from '../src/domain/ledger.ts'
import type { Rate } from '../src/domain/ledger.ts'
import { exportBackup, parseBackup } from '../src/services/backup.ts'

const first = new Date(2026, 8, 15, 12)
const second = new Date(2026, 8, 16, 12)
const rate: Rate = { cnyToJpy: 20, date: '2026-09-15', fetchedAt: first.toISOString(), source: 'Frankfurter' }
const create = () => saveAsset(EMPTY_LEDGER, { source: '自己填写的来源', currency: 'CNY', amount: '100.25' }, rate, first, 'one')

test('negative balances, precision and two-way conversion', () => {
  assert.equal(parseAmount('-100.25', 'CNY'), -10025)
  assert.equal(parseAmount('-2000', 'JPY'), -2000)
  assert.throws(() => parseAmount('1.1', 'JPY'))
  assert.throws(() => parseAmount('1.001', 'CNY'))
  assert.equal(convertedTotal({ JPY: -1000, CNY: 10025 }, 'JPY', rate), 1005)
  assert.equal(convertedTotal({ JPY: -1000, CNY: 10025 }, 'CNY', rate), 5025)
  assert.equal(convertedTotal({ JPY: -1, CNY: 0 }, 'CNY', { ...rate, cnyToJpy: 200 }), -1)
  assert.equal(convertedTotal({ JPY: 1, CNY: 100 }, 'JPY', null), null)
  assert.equal(convertedTotal({ JPY: -1000, CNY: 0 }, 'JPY', null), -1000)
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
