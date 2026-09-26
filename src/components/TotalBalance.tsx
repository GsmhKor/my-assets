import type { Currency, Snapshot } from '../domain/ledger'
import { money, totalChangeAmount } from '../domain/ledger'
import { formatMoneyChange, moneyChangeClass } from './balanceChange'

export function TotalBalance({ total, snapshots, currency, today }: { total: number | null; snapshots: Snapshot[]; currency: Currency; today: string }) {
  const change = totalChangeAmount(total, snapshots, currency, today)
  const unit = currency === 'JPY' ? 1 : 100
  const rounded = change === null ? null : Math.sign(change) * Math.round(Math.abs(change) / unit) * unit
  const amount = rounded === null ? null : formatMoneyChange(rounded, currency, { showCurrency: false })
  const previousTotal = total !== null && change !== null ? total - change : null
  const changePercent = change !== null && previousTotal !== null && previousTotal !== 0 ? change / Math.abs(previousTotal) * 100 : null
  const percentLabel = changePercent === null ? '—' : `${changePercent > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(changePercent)}%`
  return <div className="balance-line">
    <strong className={`balance-value money${(total ?? 0) < 0 ? ' negative' : ''}`} data-testid="total">{money(total, currency, 0)}</strong>
    {amount !== null && <span className={`balance-change money${moneyChangeClass(rounded)}`} aria-label={`较昨日变化 ${amount}，${changePercent === null ? '昨日总资产为 0，无法计算变化百分比' : percentLabel}`} title="较昨日总资产变化"><span>{amount}</span>{' '}<span>（{percentLabel}）</span></span>}
  </div>
}
