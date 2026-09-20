export type Currency = 'JPY' | 'CNY'
export interface Rate {
  cnyToJpy: number
  date: string
  fetchedAt: string
  source: 'Frankfurter' | '手动'
}
export interface Asset {
  id: string
  source: string
  currency: Currency
  amountMinor: number
  updatedDay: string
  updatedAt: string
}
export interface Totals { JPY: number; CNY: number }
export interface Snapshot {
  day: string
  savedAt: string
  assets: Asset[]
  totals: Totals
  rate: Rate | null
}
export interface Ledger {
  revision: number
  assets: Asset[]
  snapshots: Snapshot[]
}
export interface Draft { id?: string; source: string; currency: Currency; amount: string }
export const EMPTY_LEDGER: Ledger = { revision: 0, assets: [], snapshots: [] }
export const MAX_AMOUNT_MINOR = 90_000_000_000
export const MAX_TOTAL_MINOR = 900_000_000_000

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function shiftDay(day: string, delta: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}
export function currencyName(currency: Currency) { return currency === 'JPY' ? '日元' : '人民币' }
export function parseAmount(input: string, currency: Currency): number {
  const value = input.trim().replace(/−/g, '-')
  if (!/^-?\d+$/.test(value)) throw new Error(`${currencyName(currency)}请输入整数，可为负数或零。`)
  const units = BigInt(value.replace('-', '')) * (currency === 'JPY' ? 1n : 100n)
  if (units > BigInt(MAX_AMOUNT_MINOR)) throw new Error('金额过大，请检查输入。')
  return Number(value.startsWith('-') ? -units : units)
}
export function amountInput(asset: Asset) {
  return asset.currency === 'JPY' ? String(asset.amountMinor) : (asset.amountMinor / 100).toFixed(0)
}
export function sumAssets(assets: Asset[]): Totals {
  const totals = { JPY: 0, CNY: 0 }
  const gross = { JPY: 0, CNY: 0 }
  for (const asset of assets) {
    gross[asset.currency] += Math.abs(asset.amountMinor)
    if (!Number.isSafeInteger(gross[asset.currency]) || gross[asset.currency] > MAX_TOTAL_MINOR) throw new Error('资产累计金额过大。')
    totals[asset.currency] += asset.amountMinor
  }
  return totals
}
export function validRate(value: unknown): value is Rate {
  if (!value || typeof value !== 'object') return false
  const rate = value as Rate
  return Number.isFinite(rate.cnyToJpy) && rate.cnyToJpy >= 0.01 && rate.cnyToJpy <= 1000 && validDay(rate.date)
    && typeof rate.fetchedAt === 'string' && Number.isFinite(Date.parse(rate.fetchedAt))
    && (rate.source === 'Frankfurter' || rate.source === '手动')
}
function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n
  const absolute = numerator < 0n ? -numerator : numerator
  return sign * ((absolute + denominator / 2n) / denominator)
}
// Sum native minor units first; round once, symmetrically for assets and debts.
export function convertedTotal(totals: Totals, currency: Currency, rate: Rate | null): number | null {
  const other = currency === 'JPY' ? 'CNY' : 'JPY'
  if (totals[other] === 0) return totals[currency]
  if (!validRate(rate)) return null
  const scaled = BigInt(Math.round(rate.cnyToJpy * 100_000_000))
  const result = currency === 'JPY'
    ? roundedDivide(BigInt(totals.JPY) * 10_000_000_000n + BigInt(totals.CNY) * scaled, 10_000_000_000n)
    : roundedDivide(BigInt(totals.CNY) * scaled + BigInt(totals.JPY) * 10_000_000_000n, scaled)
  const number = Number(result)
  if (!Number.isSafeInteger(number)) throw new Error('折算金额过大，无法精确显示。')
  return number
}
export function money(minor: number | null, currency: Currency, fractionDigits = 0): string {
  if (minor === null) return '待汇率'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(minor / (currency === 'JPY' ? 1 : 100))
}
export function normalizeSource(value: string) { return value.normalize('NFKC').trim().toLocaleLowerCase() }
export function recordSnapshot(ledger: Ledger, assets: Asset[], rate: Rate | null, now = new Date()): Ledger {
  const day = localDay(now)
  if (ledger.snapshots.some(snapshot => snapshot.day > day)) throw new Error('设备日期早于已有记录，请先校正设备日期。')
  if (rate && (!validRate(rate) || rate.date > day)) throw new Error('汇率日期或数值无效，请刷新汇率。')
  const totals = sumAssets(assets)
  convertedTotal(totals, 'JPY', rate)
  convertedTotal(totals, 'CNY', rate)
  const snapshot: Snapshot = { day, savedAt: now.toISOString(), assets: structuredClone(assets), totals, rate: rate ? { ...rate } : null }
  return { revision: ledger.revision + 1, assets, snapshots: [...ledger.snapshots.filter(item => item.day !== day), snapshot] }
}
export function saveAsset(ledger: Ledger, draft: Draft, rate: Rate | null, now = new Date(), newId: string = crypto.randomUUID()): Ledger {
  const source = draft.source.trim()
  if (!source || source.length > 60 || /[\u0000-\u001f]/.test(source)) throw new Error('请输入 1～60 字的资产来源。')
  if (draft.currency !== 'JPY' && draft.currency !== 'CNY') throw new Error('只支持日元和人民币。')
  if (draft.id && !ledger.assets.some(asset => asset.id === draft.id)) throw new Error('这条资产已被删除，请刷新后重试。')
  if (ledger.assets.some(asset => asset.id !== draft.id && asset.currency === draft.currency && normalizeSource(asset.source) === normalizeSource(source))) throw new Error('这个币种下已有同名来源，请点击原记录更新余额。')
  const asset: Asset = { id: draft.id ?? newId, source, currency: draft.currency, amountMinor: parseAmount(draft.amount, draft.currency), updatedDay: localDay(now), updatedAt: now.toISOString() }
  const assets = draft.id ? ledger.assets.map(item => item.id === draft.id ? asset : item) : [...ledger.assets, asset]
  return recordSnapshot(ledger, assets, rate, now)
}
export function removeAsset(ledger: Ledger, id: string, rate: Rate | null, now = new Date()) {
  if (!ledger.assets.some(asset => asset.id === id)) throw new Error('这条资产已不存在。')
  return recordSnapshot(ledger, ledger.assets.filter(asset => asset.id !== id), rate, now)
}
export interface HistoryPoint { day: string; snapshot: Snapshot; carried: boolean }
export function correctSnapshotAmount(ledger: Ledger, day: string, assetId: string, amount: string, now = new Date()): Ledger {
  if (!validDay(day) || day > localDay(now)) throw new Error('请选择今天或之前的快照日期。')
  const snapshot = ledger.snapshots.find(item => item.day === day)
  if (!snapshot) throw new Error('此日期没有保存的快照，请重新打开历史记录。')
  const asset = snapshot.assets.find(item => item.id === assetId)
  if (!asset) throw new Error('这条资产不在所选快照中，请重新打开历史记录。')
  const corrected = { ...asset, amountMinor: parseAmount(amount, asset.currency), updatedDay: day, updatedAt: now.toISOString() }
  const assets = snapshot.assets.map(item => item.id === assetId ? corrected : item)
  const totals = sumAssets(assets)
  convertedTotal(totals, 'JPY', snapshot.rate)
  convertedTotal(totals, 'CNY', snapshot.rate)
  const updated = { ...snapshot, assets, totals, savedAt: now.toISOString() }
  return {
    revision: ledger.revision + 1,
    assets: ledger.snapshots.at(-1)?.day === day ? structuredClone(assets) : ledger.assets,
    snapshots: ledger.snapshots.map(item => item.day === day ? updated : item),
  }
}
export function historyBetween(snapshots: Snapshot[], from: string, to: string): HistoryPoint[] {
  if (!validDay(from) || !validDay(to) || from > to) return []
  const ordered = [...snapshots].sort((a, b) => a.day.localeCompare(b.day))
  const points: HistoryPoint[] = []
  let index = 0
  let current: Snapshot | undefined
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    while (index < ordered.length && ordered[index].day <= day) current = ordered[index++]
    if (current) points.push({ day, snapshot: current, carried: current.day !== day })
  }
  return points
}

export function totalChangeAmount(current: number | null, snapshots: Snapshot[], currency: Currency, today: string): number | null {
  const yesterday = shiftDay(today, -1)
  const previous = historyBetween(snapshots, yesterday, yesterday)[0]?.snapshot
  if (current === null || !previous) return null
  const previousTotal = convertedTotal(previous.totals, currency, previous.rate)
  return previousTotal === null ? null : current - previousTotal
}
