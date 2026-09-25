import type { Currency, Snapshot } from '../domain/ledger'
import { money, totalChangeAmount } from '../domain/ledger'
import { formatMoneyChange, moneyChangeClass } from './balanceChange'

export function TotalBalance({ total, snapshots, currency, today }: { total: number | null; snapshots: Snapshot[]; currency: Currency; today: string }) {
  const change = totalChangeAmount(total, snapshots, currency, today)
  const unit = currency === 'JPY' ? 1 : 100
  const rounded = change === null ? null : Math.sign(change) * Math.round(Math.abs(change) / unit) * unit
  const amount = rounded === null ? null : formatMoneyChange(rounded, currency, { showCurrency: false })
  return <div className="balance-line">
    <strong className={`balance-value money${(total ?? 0) < 0 ? ' negative' : ''}`} data-testid="total">{money(total, currency, 0)}</strong>
    {amount !== null && <span className={`balance-change money${moneyChangeClass(rounded)}`} aria-label={`较昨日变化 ${amount}`} title="较昨日总资产变化">{amount}</span>}
  </div>
}
