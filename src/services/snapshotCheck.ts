import { ensureDailySnapshot, finalizeSnapshotRate, localDay } from '../domain/ledger.ts'
import type { Ledger, Rate } from '../domain/ledger.ts'

interface SnapshotCheckOptions {
  read: () => Promise<Ledger>
  change: (transform: (ledger: Ledger) => Ledger, revision: number) => Promise<Ledger>
  rate: () => Rate | null
  canWrite: () => boolean
  fetchHistoricalRate: (day: string) => Promise<Rate | null>
  now?: () => Date
}

// Keep the lifecycle independent of React so suspended requests and concurrent checks
// use the same guards as ordinary edits. No local write waits for the network.
export function createSnapshotCheck(options: SnapshotCheckOptions) {
  const now = options.now ?? (() => new Date())
  const historyAttempts = new Map<string, number>()
  let running = false
  return async (retryHistory = false) => {
    if (running || !options.canWrite()) return false
    running = true
    try {
      let ledger = await options.read()
      if (!options.canWrite()) return false
      if (ensureDailySnapshot(ledger, options.rate(), now()) !== ledger) {
        ledger = await options.change(value => ensureDailySnapshot(value, options.rate(), now()), ledger.revision)
      }
      const past = ledger.snapshots.filter(snapshot => snapshot.day < localDay(now()))
      // Retry unfinished new records even after another day has passed. For legacy
      // backups, check only the latest past record rather than repricing all history.
      const pending = past.filter(snapshot => snapshot.rate?.source !== '手动'
        && (snapshot.rateFinalized === false || (snapshot === past.at(-1) && snapshot.rateFinalized === undefined)))
      if (!pending.length) return true
      const previous = pending.findLast(snapshot => {
        const attemptedAt = historyAttempts.get(snapshot.day)
        return retryHistory || attemptedAt === undefined || now().getTime() - attemptedAt >= 15 * 60_000
      })
      if (!previous) return false
      historyAttempts.set(previous.day, now().getTime())
      const historicalRate = await options.fetchHistoricalRate(previous.day)
      if (!options.canWrite()) return false
      await options.change(value => finalizeSnapshotRate(value, previous.day, historicalRate, now()), ledger.revision)
      return true
    } finally { running = false }
  }
}
