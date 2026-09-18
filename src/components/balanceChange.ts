import type { Asset, Currency, Snapshot } from '../domain/ledger'

export function balanceChange(asset: Asset, previous: Snapshot | undefined): number | null {
  const before = previous?.assets.find(item => item.id === asset.id && item.currency === asset.currency)
  return before ? asset.amountMinor - before.amountMinor : null
}

export function moneyChangeClass(change: number | null): string {
  return change === null || change === 0 ? '' : change > 0 ? ' money-up' : ' money-down'
}

export function formatMoneyChange(change: number | null, currency: Currency): string {
  if (change === null) return '待汇率'
  const amount = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.abs(change) / (currency === 'JPY' ? 1 : 100))
  const sign = change > 0 ? '+ ' : change < 0 ? '- ' : ''
  return `${sign}${amount} ${currency}`
}
