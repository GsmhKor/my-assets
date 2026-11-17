import type { Asset, Rate, Snapshot } from '../domain/ledger'
import { creditCardDebtSummary, money } from '../domain/ledger'
import { moneyChangeClass } from './balanceChange'

export function DebtBalance({ assets, snapshots, rate, today }: { assets: Asset[]; snapshots: Snapshot[]; rate: Rate | null; today: string }) {
  const debt = creditCardDebtSummary(assets, snapshots, rate, today)
  const previous = debt.total !== null && debt.change !== null ? debt.total - debt.change : null
  const percent = debt.change !== null && previous !== null && previous > 0 ? debt.change / previous * 100 : null
  const percentLabel = percent === null ? '—' : `${percent > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(percent)}%`
  return <p className="finance-line"><span className="finance-label">欠款</span><b className="money">{money(debt.total, 'CNY', 0)}</b><small className={`money debt-change${moneyChangeClass(percent)}`} title="较昨日欠款变化">（{percentLabel}）</small></p>
}
