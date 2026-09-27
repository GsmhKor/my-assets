import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Snapshot } from '../src/domain/ledger.ts'
import { cachedRateHistory, fetchRateHistory, parseRateHistory, recentRatePoints, snapshotRatePoints } from '../src/services/rateHistory.ts'

const now = new Date('2026-09-27T12:00:00')
const quote = (date: string, rate = 20) => ({ date, rate, base: 'CNY', quote: 'JPY' })

test('converts 10000 yen to yuan without rounding and keeps the inclusive 90-day range', () => {
  const points = parseRateHistory([quote('2026-09-26', 21), quote('2026-06-29'), quote('2026-06-30'), quote('2026-09-27')], now)
  assert.deepEqual(points, [{ day: '2026-06-30', cny: 500 }, { day: '2026-09-26', cny: 10000 / 21 }, { day: '2026-09-27', cny: 500 }])
  // Non-quote dates are not invented or filled with zero.
  assert.equal(points.length, 3)
})

test('rejects future dates, invalid currencies and invalid rates', () => {
  for (const value of [null, [], [quote('2026-09-28')], [quote('2026-09-26', 0)], [{ ...quote('2026-09-26'), base: 'JPY' }], [quote('2026-02-30')]]) {
    assert.throws(() => parseRateHistory(value, now))
  }
  assert.deepEqual(recentRatePoints([{ day: '2026-09-27', cny: NaN }, { day: '2026-09-28', cny: 500 }], '2026-09-27'), [])
})

test('snapshot fallback uses saved rates and snapshot dates, omits missing rates and preserves the ledger', () => {
  const rate = { cnyToJpy: 20, date: '2026-09-25', fetchedAt: now.toISOString(), source: '手动' as const }
  const snapshots: Snapshot[] = [
    { day: '2026-09-26', savedAt: now.toISOString(), assets: [], totals: { JPY: 0, CNY: 0 }, rate },
    { day: '2026-09-27', savedAt: now.toISOString(), assets: [], totals: { JPY: 0, CNY: 0 }, rate: null },
  ]
  const original = structuredClone(snapshots)
  assert.deepEqual(snapshotRatePoints(snapshots, '2026-09-27'), [{ day: '2026-09-26', cny: 500 }])
  assert.deepEqual(snapshots, original)
})

test('fetch caches quotes, reuses fresh cache and preserves it on network failure', async t => {
  const memory = new Map<string, string>()
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.equal(String(url), 'https://api.frankfurter.dev/v2/rates?base=CNY&quotes=JPY&from=2026-06-30&to=2026-09-27')
    return new Response(JSON.stringify([quote('2026-09-25')]))
  })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } })
  try {
    const signal = new AbortController().signal
    const points = await fetchRateHistory(signal, now)
    assert.deepEqual(cachedRateHistory('2026-09-27'), points)
    t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline') })
    assert.deepEqual(await fetchRateHistory(signal, now), points)
    await assert.rejects(fetchRateHistory(signal, new Date(now.getTime() + 16 * 60_000)), /offline/)
    assert.deepEqual(cachedRateHistory('2026-09-27'), points)
    memory.set('my-assets-rate-history', '{broken')
    assert.deepEqual(cachedRateHistory('2026-09-27'), [])
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
