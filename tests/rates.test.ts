import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDay, shiftDay } from '../src/domain/ledger.ts'
import type { Rate } from '../src/domain/ledger.ts'
import { fetchHistoricalRate, fetchRate, refreshCurrentRate } from '../src/services/rates.ts'

const endpoint = 'https://api.frankfurter.dev/v2/rate/CNY/JPY'
const quote = (date: string, rate = 21.12345678) => new Response(JSON.stringify({ base: 'CNY', quote: 'JPY', date, rate }))

test('a future latest quote falls back to an explicit local-day request without rewriting the provider date', async t => {
  const today = localDay()
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    requests.push(String(url))
    return requests.length === 1 ? quote(shiftDay(today, 1)) : quote(shiftDay(today, -1))
  })
  const result = await fetchRate()
  assert.deepEqual(requests, [endpoint, `${endpoint}?date=${today}`])
  assert.equal(result.date, shiftDay(today, -1))
  assert.equal(result.cnyToJpy, 21.12345678)
})

test('rejecting both future responses leaves subsequent refreshes usable and does not publish bad quotes', async t => {
  const today = localDay()
  let applied: Rate | null = null
  t.mock.method(globalThis, 'fetch', async () => quote(shiftDay(today, 1)))
  await assert.rejects(refreshCurrentRate({ apply: next => { applied = next } }), /晚于设备日期/)
  assert.equal(applied, null)
  t.mock.method(globalThis, 'fetch', async () => quote(today))
  await refreshCurrentRate({ apply: next => { applied = next } })
  assert.equal((applied as Rate | null)?.date, today)
})

test('historical quote rejection cannot prevent current exchange rates from refreshing', async t => {
  const today = localDay()
  const yesterday = shiftDay(today, -1)
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    requests.push(String(url))
    return quote(today)
  })
  await assert.rejects(fetchHistoricalRate(yesterday), /晚于快照日期/)
  const current = await fetchRate()
  assert.equal(current.date, today)
  assert.deepEqual(requests, [`${endpoint}?date=${yesterday}`, endpoint])
})

test('snapshot errors keep the fresh current rate and allow another successful manual refresh', async t => {
  const today = localDay()
  const previous: Rate = { cnyToJpy: 20, date: shiftDay(today, -1), fetchedAt: new Date().toISOString(), source: 'Frankfurter' }
  let current = previous
  const events: string[] = []
  t.mock.method(globalThis, 'fetch', async () => quote(today))
  const result = await refreshCurrentRate({
    apply: next => { current = next; events.push('current updated') },
    syncSnapshot: async next => {
      assert.equal(current, next)
      events.push('snapshot rejected')
      throw new Error('历史汇率必须与快照日期一致。')
    },
  })
  assert.match(String(result.snapshotError), /日期一致/)
  assert.deepEqual(events, ['current updated', 'snapshot rejected'])
  assert.equal(current.date, today)
  assert.equal(current.cnyToJpy, 21.12345678)
  const retried = await refreshCurrentRate({ apply: next => { current = next }, syncSnapshot: async () => { events.push('snapshot saved') } })
  assert.deepEqual(retried, {})
  assert.equal(events.at(-1), 'snapshot saved')
})

test('a network failure preserves the last applied quote and a later attempt can recover', async t => {
  const today = localDay()
  const applied: Rate[] = []
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline') })
  await assert.rejects(refreshCurrentRate({ apply: next => { applied.push(next) } }), /无法连接/)
  assert.deepEqual(applied, [])
  t.mock.method(globalThis, 'fetch', async () => quote(today))
  await refreshCurrentRate({ apply: next => { applied.push(next) } })
  assert.equal(applied.length, 1)
  assert.equal(applied[0].date, today)
})
