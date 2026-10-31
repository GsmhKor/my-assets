import type { Asset, Ledger } from './ledger.ts'

export const ACTIVITY_WINDOW_DAYS = 30
export interface AssetActivity {
  createdDay: string
  updates: { day: string; count: number }[]
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86400000
}

function inWindow(day: string, today: string): boolean {
  const age = dayNumber(today) - dayNumber(day)
  return age >= 0 && age < ACTIVITY_WINDOW_DAYS
}

// Old snapshots retain at most one observable balance change per day.
// Once an asset has its own counter, snapshots never contribute to it again.
export function resolveAssetActivity(ledger: Ledger, today: string): Record<string, AssetActivity> {
  const saved = new Map(Object.entries(ledger.assetActivity ?? {}))
  const inferred = new Map<string, { createdDay: string; updates: Set<string>; previous?: Asset }>()
  for (const asset of ledger.assets) {
    if (!saved.has(asset.id)) inferred.set(asset.id, { createdDay: asset.updatedDay, updates: new Set() })
  }
  function observe(asset: Asset) {
    const entry = inferred.get(asset.id)
    if (!entry) return
    if (asset.updatedDay < entry.createdDay) entry.createdDay = asset.updatedDay
    if ((!entry.previous || entry.previous.amountMinor !== asset.amountMinor || entry.previous.currency !== asset.currency)
      && inWindow(asset.updatedDay, today)) entry.updates.add(asset.updatedDay)
    entry.previous = asset
  }
  if (inferred.size) {
    for (const snapshot of ledger.snapshots) for (const asset of snapshot.assets) observe(asset)
    for (const asset of ledger.assets) observe(asset)
  }
  return Object.fromEntries(ledger.assets.map(asset => {
    const activity = saved.get(asset.id)
    if (activity) return [asset.id, {
      createdDay: activity.createdDay,
      updates: activity.updates.filter(update => inWindow(update.day, today)).map(update => ({ ...update })),
    }]
    const entry = inferred.get(asset.id)!
    return [asset.id, { createdDay: entry.createdDay, updates: [...entry.updates].sort().map(day => ({ day, count: 1 })) }]
  }))
}

export function recordAssetActivity(ledger: Ledger, asset: Asset, today: string): Record<string, AssetActivity> {
  const activities = new Map(Object.entries(resolveAssetActivity(ledger, today)))
  const previous = ledger.assets.find(item => item.id === asset.id)
  const activity = activities.get(asset.id) ?? { createdDay: today, updates: [] }
  if (!previous || previous.amountMinor !== asset.amountMinor || previous.currency !== asset.currency) {
    const update = activity.updates.find(item => item.day === today)
    if (update) update.count++
    else activity.updates.push({ day: today, count: 1 })
  }
  activities.set(asset.id, activity)
  return Object.fromEntries(activities)
}

export function assetUpdateFrequency(activity: AssetActivity | undefined, today: string): number {
  if (!activity) return 0
  const days = Math.max(1, Math.min(ACTIVITY_WINDOW_DAYS, dayNumber(today) - dayNumber(activity.createdDay) + 1))
  const count = activity.updates.reduce((total, update) => total + (inWindow(update.day, today) ? update.count : 0), 0)
  return count / days
}
