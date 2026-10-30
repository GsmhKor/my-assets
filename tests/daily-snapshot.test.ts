import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LEDGER, convertedTotal, ensureDailySnapshot, finalizeSnapshotRate, historyDisplayRate, recordSnapshot, saveAsset } from '../src/domain/ledger.ts'
import type { Rate } from '../src/domain/ledger.ts'
import { createSnapshotCheck } from '../src/services/snapshotCheck.ts'
import { fetchHistoricalRate } from '../src/services/rates.ts'
import { exportBackup, parseBackup } from '../src/services/backup.ts'

const first = new Date(2026, 8, 15, 12)
const second = new Date(2026, 8, 16, 12)
const rate: Rate = { cnyToJpy: 20.12345678, date: '2026-09-15', fetchedAt: first.toISOString(), source: 'Frankfurter' }
const create = () => saveAsset(EMPTY_LEDGER, { source: '账户', currency: 'CNY', amount: '100' }, rate, first, 'one')

function harness(initial = create()) {
  let ledger = initial
  let clock = second
  let allowed = true
  let currentRate: Rate | null = rate
  let writes = 0
  const requests: string[] = []
  let historical: (day: string) => Promise<Rate | null> = async day => ({ ...rate, date: day, fetchedAt: clock.toISOString() })
  const check = createSnapshotCheck({
    read: async () => structuredClone(ledger),
    change: async (transform, revision) => {
      assert.equal(revision, ledger.revision, 'stale writes must be rejected')
      const next = transform(ledger)
      if (next !== ledger) { writes++; ledger = { ...next, revision: ledger.revision + 1 } }
      return ledger
    },
    rate: () => currentRate,
    canWrite: () => allowed,
    now: () => clock,
    fetchHistoricalRate: async day => { requests.push(day); return historical(day) },
  })
  return { check, requests, get ledger() { return ledger }, get writes() { return writes },
    setClock(value: Date) { clock = value }, setAllowed(value: boolean) { allowed = value },
    setRate(value: Rate | null) { currentRate = value },
    setHistory(value: typeof historical) { historical = value },
    edit() { ledger = saveAsset(ledger, { id: 'one', source: '账户', currency: 'CNY', amount: '200' }, currentRate, clock) },
  }
}

test('opening on a new day records unchanged balances once, with no fabricated gap dates', async () => {
  const h = harness()
  h.setClock(new Date(2026, 8, 18, 0, 0, 5))
  const original = structuredClone(h.ledger)
  await h.check()
  assert.deepEqual(h.ledger.snapshots.map(s => s.day), ['2026-09-15', '2026-09-18'])
  assert.deepEqual(h.ledger.assets, original.assets)
  assert.deepEqual(h.ledger.snapshots[1].assets, original.assets)
  assert.equal(h.ledger.snapshots[1].rate, null, 'yesterday cache cannot be stored as today quote')
  assert.equal(h.ledger.snapshots[0].savedAt, original.snapshots[0].savedAt)
  assert.deepEqual(h.requests, ['2026-09-15'])
  await h.check()
  assert.equal(h.writes, 2)
  assert.deepEqual(parseBackup(exportBackup(h.ledger), '2026-09-18').snapshots, h.ledger.snapshots)
})

test('empty ledgers stay empty; a deleted last balance still gets a daily zero record', async () => {
  const h = harness(EMPTY_LEDGER)
  await h.check()
  assert.equal(h.writes, 0)
  assert.deepEqual(h.requests, [])
  const zero = recordSnapshot(create(), [], rate, first)
  assert.deepEqual(ensureDailySnapshot(zero, null, second).snapshots.at(-1)?.totals, { JPY: 0, CNY: 0 })
})

test('offline checks save today before requesting history and retry without duplicate records', async () => {
  const h = harness()
  h.setRate(null)
  h.setHistory(async () => {
    assert.equal(h.ledger.snapshots.at(-1)?.day, '2026-09-16')
    throw new Error('offline')
  })
  await assert.rejects(h.check(), /offline/)
  assert.equal(h.ledger.snapshots[1].rate, null)
  await h.check()
  assert.equal(h.requests.length, 1)
  h.setHistory(async day => ({ ...rate, date: day }))
  await h.check(true)
  assert.equal(h.requests.length, 2)
  assert.equal(h.ledger.snapshots[0].rateFinalized, true)
  assert.equal(h.ledger.snapshots.length, 2)
})

test('latest quotes update only today, keep full precision, and cannot downgrade to stale caches', async () => {
  const h = harness()
  await h.check()
  const previous = structuredClone(h.ledger.snapshots[0])
  const fresh = { ...rate, date: '2026-09-16', cnyToJpy: 21.98765432, fetchedAt: second.toISOString() }
  h.setRate(fresh)
  await h.check()
  assert.deepEqual(h.ledger.snapshots[0], previous)
  assert.deepEqual(h.ledger.snapshots[1].rate, fresh)
  assert.equal(convertedTotal(h.ledger.snapshots[1].totals, 'JPY', fresh), 2199)
  h.setRate(rate)
  await h.check()
  assert.deepEqual(h.ledger.snapshots[1].rate, fresh)
  h.setRate({ ...fresh, cnyToJpy: 22 })
  await h.check()
  assert.deepEqual(h.ledger.snapshots[0], previous)
})

test('historical date checks reject future quotes and do not change balances or other snapshots', () => {
  const original = ensureDailySnapshot(create(), rate, second)
  assert.throws(() => finalizeSnapshotRate(original, '2026-09-15', { ...rate, date: '2026-09-16' }, second), /日期一致/)
  assert.throws(() => finalizeSnapshotRate(original, '2026-09-15', { ...rate, date: '2026-09-14' }, second), /日期一致/)
  assert.throws(() => finalizeSnapshotRate(original, '2026-09-16', rate, second))
  const changed = finalizeSnapshotRate(original, '2026-09-15', { ...rate, cnyToJpy: 21.12345678 }, second)
  assert.deepEqual(changed.assets, original.assets)
  assert.deepEqual(changed.snapshots[0].assets, original.snapshots[0].assets)
  assert.deepEqual(changed.snapshots[0].totals, original.snapshots[0].totals)
  assert.equal(changed.snapshots[0].savedAt, original.snapshots[0].savedAt)
  assert.deepEqual(changed.snapshots[1], original.snapshots[1])
  assert.equal(finalizeSnapshotRate(changed, '2026-09-15', rate, second), changed)
  assert.equal(historyDisplayRate(changed.snapshots[0], '2026-09-16', { ...rate, cnyToJpy: 30 })?.cnyToJpy, 21.12345678)
  assert.equal(historyDisplayRate(changed.snapshots[0], '2026-09-15', { ...rate, date: '2026-09-16' }), null)
  assert.equal(historyDisplayRate({ ...changed.snapshots[0], rate: { ...rate, date: '2026-09-14' } }, '2026-09-16'), null)
})

test('missing same-day quotes remain unavailable and eligible for retry after delayed publication', async () => {
  const h = harness()
  h.setHistory(async () => null)
  await h.check()
  assert.equal(h.ledger.snapshots[0].rate, null)
  assert.equal(h.ledger.snapshots[0].rateFinalized, false)
  h.setClock(new Date(second.getTime() + 16 * 60_000))
  h.setHistory(async () => rate)
  await h.check()
  assert.equal(h.ledger.snapshots[0].rateFinalized, true)
  assert.equal(h.ledger.snapshots[0].rate?.date, '2026-09-15')
})

test('blocked editing and concurrent lifecycle checks cannot race a pending historical request', async () => {
  const h = harness()
  let finish!: (rate: Rate) => void
  h.setHistory(() => new Promise(resolve => { finish = resolve }))
  const pending = h.check()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.ledger.snapshots.length, 2)
  await h.check()
  assert.equal(h.requests.length, 1)
  h.setAllowed(false)
  finish(rate)
  await pending
  assert.equal(h.ledger.snapshots[0].rateFinalized, false)
  h.setAllowed(true)
  h.setHistory(async () => rate)
  await h.check(true)
  assert.equal(h.ledger.snapshots[0].rateFinalized, true)
})

test('an intervening edit rejects a stale history response without losing the edit', async () => {
  const h = harness()
  let finish!: (rate: Rate) => void
  h.setHistory(() => new Promise(resolve => { finish = resolve }))
  const pending = h.check()
  await new Promise(resolve => setImmediate(resolve))
  h.edit()
  finish(rate)
  await assert.rejects(pending, /stale writes/)
  assert.equal(h.ledger.assets[0].amountMinor, 20000)
  assert.equal(h.ledger.snapshots.at(-1)?.totals.CNY, 20000)
  assert.equal(h.ledger.snapshots[0].totals.CNY, 10000)
})

test('a request spanning another midnight never puts a newer quote into the prior date', async () => {
  const h = harness()
  h.setHistory(async () => { h.setClock(new Date(2026, 8, 17, 0, 0, 1)); return rate })
  await h.check()
  h.setHistory(async day => ({ ...rate, date: day, fetchedAt: new Date(2026, 8, 17, 0, 0, 2).toISOString() }))
  h.setRate({ ...rate, date: '2026-09-17', cnyToJpy: 23 })
  await h.check()
  assert.deepEqual(h.ledger.snapshots.map(s => s.day), ['2026-09-15', '2026-09-16', '2026-09-17'])
  assert.deepEqual(h.ledger.snapshots.map(s => s.rate?.date), ['2026-09-15', '2026-09-16', '2026-09-17'])
})

test('clock rollback refuses new snapshots; cached future quotes never enter today', () => {
  assert.throws(() => ensureDailySnapshot(create(), rate, new Date(2026, 8, 14)), /校正/)
  const next = ensureDailySnapshot(create(), { ...rate, date: '2026-09-17' }, second)
  assert.equal(next.snapshots[1].rate, null)
  const stale = recordSnapshot(create(), create().assets, rate, second)
  assert.equal(stale.snapshots[1].rate, null)
  assert.equal(ensureDailySnapshot(stale, rate, second), stale)
})

test('unfinished quotes survive another day and missing daily quotes round trip without inventing a rate', async () => {
  const h = harness()
  h.setHistory(async () => null)
  await h.check()
  assert.equal(h.ledger.snapshots[0].rateFinalized, false)
  h.setClock(new Date(2026, 8, 17, 12))
  await h.check()
  // Check the newer pending day first, then resume the earlier unfinished check.
  await h.check()
  assert.equal(h.ledger.snapshots[0].rateFinalized, true)
  assert.equal(h.ledger.snapshots[0].rate, null)
  assert.equal(h.ledger.snapshots[1].rateFinalized, false)
  assert.deepEqual(parseBackup(exportBackup(h.ledger), '2026-09-17').snapshots, h.ledger.snapshots)
})

test('legacy snapshots and manual historical quotes are preserved outside the last pending date', async () => {
  const initial = ensureDailySnapshot(create(), { ...rate, date: '2026-09-16' }, second)
  for (const snapshot of initial.snapshots) delete snapshot.rateFinalized
  const h = harness(initial)
  h.setClock(new Date(2026, 8, 17, 12))
  const older = structuredClone(initial.snapshots[0])
  await h.check()
  await h.check()
  assert.deepEqual(h.requests, ['2026-09-16'])
  assert.deepEqual(h.ledger.snapshots[0], older)
  const manual = { ...initial, snapshots: initial.snapshots.map(snapshot => ({ ...snapshot, rate: { ...snapshot.rate!, source: '手动' as const } })) }
  const manualCheck = harness(manual)
  manualCheck.setClock(new Date(2026, 8, 17, 12))
  await manualCheck.check()
  assert.deepEqual(manualCheck.requests, [])
})

test('historical network requests specify the target date and reject newer provider dates', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.equal(String(url), 'https://api.frankfurter.dev/v2/rate/CNY/JPY?date=2026-09-15')
    return new Response(JSON.stringify({ base: 'CNY', quote: 'JPY', date: '2026-09-15', rate: 20.12345678 }))
  })
  assert.equal((await fetchHistoricalRate('2026-09-15'))?.cnyToJpy, 20.12345678)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ base: 'CNY', quote: 'JPY', date: '2026-09-14', rate: 20 })))
  assert.equal(await fetchHistoricalRate('2026-09-15'), null)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ base: 'CNY', quote: 'JPY', date: '2026-09-16', rate: 20 })))
  await assert.rejects(fetchHistoricalRate('2026-09-15'), /晚于快照日期/)
  await assert.rejects(fetchHistoricalRate('2026-02-30'))
})
