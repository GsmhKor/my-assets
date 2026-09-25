import type { Asset, Currency, Snapshot } from '../domain/ledger'
import { normalizeSource } from '../domain/ledger'

export function balanceChange(asset: Asset, previous: Snapshot | undefined): number | null {
  if (!previous) return null
  const byId = previous.assets.find(item => item.id === asset.id)
  if (byId) return byId.currency === asset.currency ? asset.amountMinor - byId.amountMinor : null

  // Recreated or imported records can retain their source name but have a new ID.
  const source = normalizeSource(asset.source)
  const matches = previous.assets.filter(item => item.currency === asset.currency && normalizeSource(item.source) === source)
  return matches.length === 1 ? asset.amountMinor - matches[0].amountMinor : null
}

export function moneyChangeClass(change: number | null): string {
  return change === null || change === 0 ? '' : change > 0 ? ' money-up' : ' money-down'
}

export function formatMoneyChange(change: number | null, currency: Currency, { showCurrency = true }: { showCurrency?: boolean } = {}): string {
  if (change === null) return '待汇率'
  const amount = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.abs(change) / (currency === 'JPY' ? 1 : 100))
  const sign = change > 0 ? '+ ' : change < 0 ? '- ' : ''
  return `${sign}${amount}${showCurrency ? ` ${currency}` : ''}`
}
