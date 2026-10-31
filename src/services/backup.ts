import { MAX_AMOUNT_MINOR, localDay, sumAssets, validDay, validRate, convertedTotal } from '../domain/ledger.ts'
import type { Asset, Ledger, Snapshot } from '../domain/ledger.ts'
import type { AssetActivity } from '../domain/assetActivity.ts'
import { ACTIVITY_WINDOW_DAYS } from '../domain/assetActivity.ts'
function assert(condition: unknown, message = '备份内容无效或不完整。'): asserts condition { if (!condition) throw new Error(message) }
function object(value: unknown): Record<string, unknown> { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown> }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) }
function assets(value: unknown, latestDay: string): Asset[] {
  assert(Array.isArray(value) && value.length <= 10000)
  const ids = new Set<string>(); const names = new Set<string>()
  const result = value.map((item): Asset => {
    const a = object(item)
    assert(typeof a.id === 'string' && a.id.length > 0 && a.id.length <= 100 && !ids.has(a.id)); ids.add(a.id)
    assert(typeof a.source === 'string' && a.source.trim() === a.source && a.source.length > 0 && a.source.length <= 60 && !/[\u0000-\u001f]/.test(a.source))
    assert(a.currency === 'JPY' || a.currency === 'CNY')
    const key = `${a.currency}:${a.source.normalize('NFKC').toLocaleLowerCase()}`
    assert(!names.has(key), '备份包含重复资产来源。'); names.add(key)
    assert(Number.isSafeInteger(a.amountMinor) && Math.abs(a.amountMinor as number) <= MAX_AMOUNT_MINOR)
    assert(validDay(a.updatedDay) && a.updatedDay <= latestDay && timestamp(a.updatedAt))
    return { id: a.id, source: a.source, currency: a.currency, amountMinor: a.amountMinor as number, updatedDay: a.updatedDay, updatedAt: a.updatedAt }
  })
  sumAssets(result)
  return result
}
function assetActivity(value: unknown, current: Asset[], today: string): Record<string, AssetActivity> {
  const entries = Object.entries(object(value))
  const ids = new Set(current.map(asset => asset.id))
  assert(entries.length <= current.length)
  return Object.fromEntries(entries.map(([id, item]) => {
    assert(ids.has(id))
    const activity = object(item)
    assert(validDay(activity.createdDay) && activity.createdDay <= today)
    const createdDay = activity.createdDay
    assert(Array.isArray(activity.updates) && activity.updates.length <= ACTIVITY_WINDOW_DAYS)
    let previousDay = ''; let total = 0
    const updates = activity.updates.map(item => {
      const update = object(item)
      assert(validDay(update.day) && update.day >= createdDay && update.day > previousDay && update.day <= today)
      assert(Number.isSafeInteger(update.count) && (update.count as number) > 0)
      previousDay = update.day
      total += update.count as number
      assert(Number.isSafeInteger(total))
      return { day: update.day, count: update.count as number }
    })
    return [id, { createdDay, updates }]
  }))
}
export function parseBackup(text: string, today = localDay()): Ledger {
  assert(text.length <= 20_000_000, '备份文件超过 20 MB。')
  const root = object(JSON.parse(text))
  assert(root.app === 'my-assets' && root.schemaVersion === 1, '请选择「资金账本」的 JSON 备份，不能导入收支账本。')
  assert(timestamp(root.exportedAt))
  const data = object(root.data)
  assert(Array.isArray(data.snapshots) && data.snapshots.length <= 36600)
  let previousDay = ''
  const snapshots: Snapshot[] = data.snapshots.map(item => {
    const s = object(item)
    assert(validDay(s.day) && s.day > previousDay && s.day <= today, '历史日期重复、顺序错误或晚于今天。')
    previousDay = s.day
    assert(timestamp(s.savedAt))
    assert(s.rate === null || (validRate(s.rate) && s.rate.date <= s.day))
    assert(s.rateFinalized === undefined || typeof s.rateFinalized === 'boolean')
    assert(s.rateFinalized !== true || s.rate === null || s.rate.date === s.day, '已固定的历史汇率必须与快照日期一致。')
    const rows = assets(s.assets, s.day)
    const computed = sumAssets(rows); const saved = object(s.totals)
    assert(saved.JPY === computed.JPY && saved.CNY === computed.CNY, '快照总额与资产明细不一致。')
    const rate = s.rate === null ? null : { ...s.rate }
    convertedTotal(computed, 'JPY', rate); convertedTotal(computed, 'CNY', rate)
    return { day: s.day, savedAt: s.savedAt, assets: rows, totals: computed, rate, ...(typeof s.rateFinalized === 'boolean' ? { rateFinalized: s.rateFinalized } : {}) }
  })
  const current = assets(data.assets, today)
  assert(snapshots.length > 0 || current.length === 0)
  if (snapshots.length) assert(JSON.stringify(current) === JSON.stringify(snapshots.at(-1)!.assets), '当前资产与最后一次快照不一致。')
  return { revision: 0, assets: current, snapshots, ...(data.assetActivity === undefined ? {} : { assetActivity: assetActivity(data.assetActivity, current, today) }) }
}
export function exportBackup(ledger: Ledger) {
  // Export saved state only; never expand calendar gaps into carried records.
  const data = { revision: ledger.revision, assets: ledger.assets, snapshots: ledger.snapshots, ...(ledger.assetActivity === undefined ? {} : { assetActivity: ledger.assetActivity }) }
  return JSON.stringify({ app: 'my-assets', schemaVersion: 1, exportedAt: new Date().toISOString(), data }, null, 2)
}
export function downloadBackup(ledger: Ledger) {
  const url = URL.createObjectURL(new Blob([exportBackup(ledger)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = '我的资金-完整备份.json'
  document.body.append(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
