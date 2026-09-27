import { localDay, shiftDay, validDay, validRate } from '../domain/ledger.ts'
import type { Snapshot } from '../domain/ledger.ts'
import { parseRateResponse } from './rates.ts'

export interface RatePoint { day: string; cny: number }
interface HistoryCache { fetchedAt: string; through: string; points: RatePoint[] }
const CACHE_KEY = 'my-assets-rate-history'

export function recentRatePoints(points: readonly RatePoint[], today: string): RatePoint[] {
  const start = shiftDay(today, -99)
  const days = new Map<string, RatePoint>()
  for (const point of points) {
    if (point && validDay(point.day) && point.day >= start && point.day <= today && Number.isFinite(point.cny) && point.cny >= 10 && point.cny <= 1_000_000) days.set(point.day, point)
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function snapshotRatePoints(snapshots: readonly Snapshot[], today: string): RatePoint[] {
  return recentRatePoints(snapshots.flatMap(snapshot => validRate(snapshot.rate) && snapshot.rate.date <= snapshot.day
    ? [{ day: snapshot.day, cny: 10000 / snapshot.rate.cnyToJpy }] : []), today)
}

export function parseRateHistory(value: unknown, now = new Date()): RatePoint[] {
  if (!Array.isArray(value)) throw new Error('历史汇率数据无效。')
  const points = value.map(row => {
    const rate = parseRateResponse(row, now)
    return { day: rate.date, cny: 10000 / rate.cnyToJpy }
  })
  const recent = recentRatePoints(points, localDay(now))
  if (!recent.length) throw new Error('暂无近期历史汇率。')
  return recent
}

function readCache(): HistoryCache | null {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as HistoryCache | null
    return data && validDay(data.through) && Number.isFinite(Date.parse(data.fetchedAt)) && Array.isArray(data.points) ? data : null
  } catch { return null }
}

export function cachedRateHistory(today: string): RatePoint[] {
  return recentRatePoints(readCache()?.points ?? [], today)
}

export async function fetchRateHistory(signal: AbortSignal, now = new Date()): Promise<RatePoint[]> {
  const today = localDay(now)
  const cached = readCache()
  const age = cached ? now.getTime() - Date.parse(cached.fetchedAt) : Infinity
  const points = recentRatePoints(cached?.points ?? [], today)
  if (cached?.through === today && age >= 0 && age < 15 * 60_000 && points.length) return points
  const response = await fetch(`https://api.frankfurter.dev/v2/rates?base=CNY&quotes=JPY&from=${shiftDay(today, -99)}&to=${today}`, {
    signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
  })
  if (!response.ok) throw new Error(`历史汇率请求失败（HTTP ${response.status}）。`)
  const next = parseRateHistory(await response.json(), now)
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: now.toISOString(), through: today, points: next })) } catch { /* chart remains available in memory */ }
  return next
}
