import type { Asset, Rate, Snapshot } from '../domain/ledger'
import { creditCardDebtSummary, money } from '../domain/ledger'
import { moneyChangeClass } from './balanceChange'

export function DebtBalance({ assets, snapshots, rate, today }: { assets: Asset[]; snapshots: Snapshot[]; rate: Rate | null; today: string }) {
  const debt = creditCardDebtSummary(assets, snapshots, rate, today)
  return <p className="finance-line"><span className="finance-label">欠款</span><b className={`money${moneyChangeClass(debt.change)}`}>{money(debt.total, 'CNY', 0)}</b></p>
}
