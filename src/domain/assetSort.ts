import type { Asset } from './ledger.ts'

export type AssetSortOrder = 'asc' | 'desc'

export function assetSortPreference(value: string): AssetSortOrder {
  return value === 'desc' ? 'desc' : 'asc'
}

const pinyin = new Intl.Collator('zh-CN-u-co-pinyin', { usage: 'sort', sensitivity: 'base', numeric: true })

export function sortAssets(assets: readonly Asset[], order: AssetSortOrder): Asset[] {
  const direction = order === 'desc' ? -1 : 1
  return [...assets].sort((a, b) => direction * pinyin.compare(a.source, b.source))
}
