import type { Asset } from './ledger.ts'

export type AssetSortOrder = 'default' | 'desc' | 'asc'

export function assetSortPreference(value: string): AssetSortOrder {
  return value === 'asc' || value === 'desc' ? value : 'default'
}

const pinyin = new Intl.Collator('zh-CN-u-co-pinyin', { usage: 'sort', sensitivity: 'base', numeric: true })

export function sortAssets(assets: readonly Asset[], order: AssetSortOrder): Asset[] {
  if (order === 'default') return [...assets].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  const direction = order === 'desc' ? -1 : 1
  return [...assets].sort((a, b) => direction * pinyin.compare(a.source, b.source))
}
