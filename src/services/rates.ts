import { localDay, validRate } from '../domain/ledger.ts'
import type { Rate } from '../domain/ledger.ts'
const CACHE_KEY = 'my-assets-rate'
export function cachedRate(): Rate | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
    return validRate(value) && value.date <= localDay() ? value : null
  } catch { return null }
}
export function cacheRate(rate: Rate) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(rate)) } catch { /* in-memory rate remains usable */ }
}
export function parseRateResponse(value: unknown, now = new Date()): Rate {
  if (!value || typeof value !== 'object') throw new Error('汇率服务返回了无效数据。')
  const data = value as Record<string, unknown>
  const result = { cnyToJpy: data.rate, date: data.date, fetchedAt: now.toISOString(), source: 'Frankfurter' }
  if (data.base !== 'CNY' || data.quote !== 'JPY' || !validRate(result) || result.date > localDay(now)) throw new Error('汇率服务返回了无效数据。')
  return result
}
export async function fetchRate(): Promise<Rate> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch('https://api.frankfurter.dev/v2/rate/CNY/JPY', { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error('汇率服务暂时不可用。')
    const rate = parseRateResponse(await response.json())
    cacheRate(rate)
    return rate
  } finally { clearTimeout(timer) }
}
