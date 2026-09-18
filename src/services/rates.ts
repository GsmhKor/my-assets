import { localDay, validRate } from '../domain/ledger.ts'
import type { Rate } from '../domain/ledger.ts'
const CACHE_KEY = 'my-assets-rate'
class FutureRateDateError extends Error {}
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
  if (data.base !== 'CNY' || data.quote !== 'JPY' || !validRate(result)) throw new Error('汇率服务返回了无效数据。')
  if (result.date > localDay(now)) throw new FutureRateDateError(`汇率报价日期 ${result.date} 晚于设备日期 ${localDay(now)}，暂不采用。`)
  return result
}
async function requestRate(url: string): Promise<Rate> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (response.status === 429) throw new Error('汇率服务请求过于频繁（HTTP 429），请稍后刷新。')
    if (!response.ok) throw new Error(`汇率服务暂时不可用（HTTP ${response.status}）。`)
    return parseRateResponse(await response.json())
  } catch (error) {
    if (controller.signal.aborted) throw new Error('汇率请求超时（12 秒），请稍后刷新。')
    if (error instanceof TypeError) throw new Error('无法连接汇率服务，请检查网络或浏览器的访问限制。')
    if (error instanceof SyntaxError) throw new Error('汇率服务返回的内容无法解析，请稍后刷新。')
    throw error
  } finally { clearTimeout(timer) }
}
export async function fetchRate(): Promise<Rate> {
  const endpoint = 'https://api.frankfurter.dev/v2/rate/CNY/JPY'
  try { return await requestRate(endpoint) }
  catch (error) {
    if (!(error instanceof FutureRateDateError)) throw error
    // Ask the provider for today's quote without rewriting its reported date.
    return requestRate(`${endpoint}?date=${localDay()}`)
  }
}
