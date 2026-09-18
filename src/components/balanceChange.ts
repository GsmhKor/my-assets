import type { Asset, Snapshot } from '../domain/ledger'

export function balanceChange(asset: Asset, previous: Snapshot | undefined): number | null {
  const before = previous?.assets.find(item => item.id === asset.id && item.currency === asset.currency)
  return before ? asset.amountMinor - before.amountMinor : null
}

export function moneyChangeClass(change: number | null): string {
  return change === null || change === 0 ? '' : change > 0 ? ' money-up' : ' money-down'
}
