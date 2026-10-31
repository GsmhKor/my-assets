import type { Asset } from './ledger.ts'
import { localDay } from './ledger.ts'
import { assetUpdateFrequency } from './assetActivity.ts'
import type { AssetActivity } from './assetActivity.ts'

export type AssetSortOrder = 'default' | 'asc' | 'desc'

export const assetSortLabels: Record<AssetSortOrder, string> = { default: '默认', asc: '升序', desc: '降序' }

export function assetSortPreference(value: string): AssetSortOrder {
  return value === 'asc' || value === 'desc' ? value : 'default'
}

export function nextAssetSort(order: AssetSortOrder): AssetSortOrder {
  return order === 'default' ? 'asc' : order === 'asc' ? 'desc' : 'default'
}

const pinyin = new Intl.Collator('zh-CN-u-co-pinyin', { usage: 'sort', sensitivity: 'base', numeric: true })

export function sortAssets(assets: readonly Asset[], order: AssetSortOrder, activities: Readonly<Record<string, AssetActivity>> = {}, today = localDay()): Asset[] {
  const direction = order === 'desc' ? -1 : 1
  const frequencies = new Map(order === 'default' ? assets.map(asset => [asset.id, assetUpdateFrequency(Object.hasOwn(activities, asset.id) ? activities[asset.id] : undefined, today)]) : [])
  return [...assets].sort((a, b) => {
    if (order === 'default') {
      const frequency = frequencies.get(b.id)! - frequencies.get(a.id)!
      if (frequency) return frequency
      const recent = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      if (recent) return recent
    }
    return direction * pinyin.compare(a.source, b.source) || a.id.localeCompare(b.id)
  })
}
