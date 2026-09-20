import type { Currency, Snapshot } from '../domain/ledger'
import { money, totalChangePercent } from '../domain/ledger'
import { moneyChangeClass } from './balanceChange'

export function TotalBalance({ total, snapshots, currency, today }: { total: number | null; snapshots: Snapshot[]; currency: Currency; today: string }) {
  const change = totalChangePercent(total, snapshots, currency, today)
  const rounded = change === null ? null : Math.round(change * 100) / 100 || 0
  const percentage = rounded === null ? null : new Intl.NumberFormat('zh-CN', {
    style: 'percent', signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(rounded / 100)
  return <div className="balance-line">
    <strong className={`balance-value money${(total ?? 0) < 0 ? ' negative' : ''}`} data-testid="total">{money(total, currency, 0)}</strong>
    {percentage !== null && <span className={`balance-change money${moneyChangeClass(rounded)}`} aria-label={`较昨日变化 ${percentage}`} title="较昨日总资产变化">{percentage}</span>}
  </div>
}
