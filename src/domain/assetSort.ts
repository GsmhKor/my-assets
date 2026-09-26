import type { Asset, Rate } from './ledger.ts'
import { validRate } from './ledger.ts'

export type AssetSortOrder = 'desc' | 'asc'

export function sortAssetsByAmount(assets: readonly Asset[], order: AssetSortOrder, rate: Rate | null): Asset[] {
  const exchange = validRate(rate) ? rate.cnyToJpy : null
  const direction = order === 'desc' ? -1 : 1
  // Compare unrounded yen values so small differences are not lost in conversion.
  const value = (asset: Asset) => asset.currency === 'JPY' ? asset.amountMinor : asset.amountMinor / 100 * (exchange ?? 1)
  return [...assets].sort((a, b) => {
    // Without an exchange rate, only balances in the same currency are comparable.
    if (exchange === null && a.currency !== b.currency) return a.currency === 'JPY' ? -1 : 1
    return direction * (value(a) - value(b))
  })
}
