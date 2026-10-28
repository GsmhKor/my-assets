import { useState } from 'react'
import type { Asset, Currency, HistoryPoint, Rate, Snapshot } from '../domain/ledger'
import { convertedTotal, currencyName, historyDisplayRate, money, ordinaryTotals } from '../domain/ledger'
import { Icon } from './Icon'
import { balanceChange, formatMoneyChange, moneyChangeClass } from './balanceChange'

type HistoryListProps = {
  points: HistoryPoint[]
  currency: Currency
  today: string
  currentRate?: Rate | null
  onCorrect: (day: string, asset: Asset) => void
  busy: boolean
}

export function HistoryList({ points, currency, today, currentRate, onCorrect, busy }: HistoryListProps) {
  const [showAll, setShowAll] = useState(false)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set())
  const visiblePoints = (showAll ? points.slice() : points.slice(-3)).reverse()
  function toggleDay(day: string, open: boolean) {
    setExpandedDays(previous => {
      if (previous.has(day) === open) return previous
      const next = new Set(previous)
      if (open) next.add(day)
      else next.delete(day)
      return next
    })
  }
  function toggleAll() {
    if (showAll) {
      const recent = new Set(points.slice(-3).map(point => point.day))
      setExpandedDays(previous => new Set([...previous].filter(day => recent.has(day))))
    }
    setShowAll(value => !value)
  }
  return <>
    <div id="history-days" className="history-list">{visiblePoints.map((point, index) =>
      <HistoryDay key={point.day} point={point} previous={points[points.length - index - 2]?.snapshot} currency={currency} today={today} currentRate={currentRate} onCorrect={onCorrect} busy={busy} open={expandedDays.has(point.day)} onToggle={open => toggleDay(point.day, open)} />
    )}</div>
    {points.length > 3 && <button type="button" className="secondary-button" aria-expanded={showAll} aria-controls="history-days" onClick={toggleAll}>{showAll ? '收起历史' : '展开全部历史'}{!showAll && ' (' + points.length + '天)'}</button>}
  </>
}

export function HistoryDay({ point, previous, currency, today, currentRate, onCorrect, busy, open, onToggle }: Omit<HistoryListProps, 'points'> & {
  point: HistoryPoint
  previous?: Snapshot
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const nativeLabel = `实际${currencyName(currency)}资产`
  const totals = ordinaryTotals(point.snapshot.totals, point.snapshot.assets)
  const previousTotals = previous ? ordinaryTotals(previous.totals, previous.assets) : null
  const displayRate = historyDisplayRate(point.snapshot, today, currentRate)
  const total = convertedTotal(totals, currency, displayRate)
  const previousTotal = previousTotals ? convertedTotal(previousTotals, currency, displayRate) : null
  const totalChange = total !== null && previousTotal !== null ? total - previousTotal : null
  const nativeChange = previousTotals ? totals[currency] - previousTotals[currency] : null
  const comparison = previous ? `较 ${previous.day}` : '暂无可比记录'
  return <details className="card day-card" open={open} onToggle={event => onToggle(event.currentTarget.open)}>
      <summary><span><strong>{point.day}{point.day === today ? ' · 今天' : ''}</strong><small>当日最后保存</small></span><b className="money"><small>总资产</small><span className={`money${total !== null && total < 0 ? ' negative' : ''}`} title={totalChange !== null ? `${comparison} ${formatMoneyChange(totalChange, currency)}` : '暂无可比金额'}>{money(total, currency, 0)}</span><small className={`money${totals[currency] < 0 ? ' negative' : ''}`} title={nativeChange !== null ? `${comparison} ${formatMoneyChange(nativeChange, currency)}` : comparison}>{nativeLabel} {money(totals[currency], currency, 0)}</small></b><Icon name="chevron-right" size={17} /></summary>
      {open && <div className="day-detail"><p className="small muted"><span className={`money${totals.JPY < 0 ? ' negative' : ''}`}>日元 {money(totals.JPY, 'JPY')}</span> · <span className={`money${totals.CNY < 0 ? ' negative' : ''}`}>人民币 {money(totals.CNY, 'CNY', 0)}</span></p>{previous && <p className="small muted">{comparison}：总资产 <span className={`money${moneyChangeClass(totalChange)}`}>{formatMoneyChange(totalChange, currency, { showCurrency: false })}</span> · 实际余额 <span className={`money${moneyChangeClass(nativeChange)}`}>{formatMoneyChange(nativeChange, currency, { showCurrency: false })}</span></p>}<p className="small muted">{displayRate ? <>
        {point.day === today && currentRate !== undefined ? '当前汇率' : '快照汇率'}<br />
        1 CNY = {displayRate.cnyToJpy.toFixed(2)} JPY<br />
        10000 JPY = {(10000 / displayRate.cnyToJpy).toFixed(2)} CNY<br />
        （{displayRate.date} · {displayRate.source}）
      </> : '此快照没有汇率，跨币种总额暂不可用。'}</p>
        {point.snapshot.assets.map(asset => {
          const change = balanceChange(asset, previous)
          return <div className="snapshot-row" key={asset.id}><span>{asset.source}<small className={`money${asset.amountMinor < 0 ? ' negative' : ''}`} title={change !== null ? `${comparison} ${formatMoneyChange(change, asset.currency)}` : '暂无可比记录'}>{money(asset.amountMinor, asset.currency)}</small></span><button className="text-button" disabled={busy} onClick={() => onCorrect(point.snapshot.day, asset)} aria-label={`修改 ${point.snapshot.day} 快照中 ${asset.source} 的金额`}>修改历史金额</button></div>
        })}
        {!point.snapshot.assets.length && <p className="small muted">当日没有持有资产。</p>}
      </div>}
    </details>
}
