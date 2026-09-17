import { useMemo, useState } from 'react'
import type { Asset, Currency, Ledger } from '../domain/ledger'
import { convertedTotal, historyBetween, money, shiftDay } from '../domain/ledger'
import { Icon } from './Icon'

export function History({ ledger, currency, today, onEdit }: { ledger: Ledger; currency: Currency; today: string; onEdit: (asset: Asset) => void }) {
  const [month, setMonth] = useState(today.slice(0, 7))
  const from = `${month}-01`
  const next = new Date(`${from}T12:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const end = shiftDay(next.toISOString().slice(0, 10), -1)
  const to = end < today ? end : today
  const points = useMemo(() => historyBetween(ledger.snapshots, from, to), [ledger.snapshots, from, to])
  const amounts = points.map(point => convertedTotal(point.snapshot.totals, currency, point.snapshot.rate))
  const valid = amounts.filter((value): value is number => value !== null)
  const min = Math.min(...valid); const max = Math.max(...valid)
  const range = max === min ? 1 : max - min
  const x = (index: number) => 18 + (index / Math.max(points.length - 1, 1)) * 284
  const y = (amount: number) => max === min ? 75 : 130 - (amount - min) / range * 110
  const path = amounts.map((amount, index) => amount === null ? '' : `${index === 0 || amounts[index - 1] === null ? 'M' : 'L'} ${x(index)} ${y(amount)}`).join(' ')
  function move(delta: number) { const date = new Date(`${from}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); setMonth(date.toISOString().slice(0, 7)) }
  return <>
    <div className="section-heading"><div><p className="eyebrow">每天的积累</p><h1>资产日历</h1></div></div>
    <div className="month-switch"><button className="icon-button" aria-label="上个月" disabled={Boolean(ledger.snapshots.length && month <= ledger.snapshots[0].day.slice(0, 7))} onClick={() => move(-1)}><Icon name="chevron-left" /></button><label><span className="sr-only">选择月份</span><input type="month" value={month} min={ledger.snapshots[0]?.day.slice(0, 7)} max={today.slice(0, 7)} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value) }} /></label><button className="icon-button" aria-label="下个月" disabled={month >= today.slice(0, 7)} onClick={() => move(1)}><Icon name="chevron-right" /></button></div>
    <section className="card history-chart"><h2>每日总资产 · {currency}</h2><p className="muted small">未更新的日期，沿用上次保存的总资产与汇率。</p>
      {points.length ? <>
        {valid.length > 0 && <><div className="chart-labels"><span>最高 {money(max, currency)}</span><span>最低 {money(min, currency)}</span></div><svg viewBox="0 0 320 158" role="img" aria-label={`${month}每日总资产折线图，详细金额见下方日期列表`}><path d="M18 140H302" className="chart-axis" /><path d={path} className="chart-line" />{amounts.map((amount, index) => amount !== null && <circle key={points[index].day} cx={x(index)} cy={y(amount)} r="3" className="chart-dot" />)}</svg><div className="chart-labels"><span>{points[0].day}</span><span>{points.at(-1)?.day}</span></div></>}
        {!valid.length && <p className="muted">这些快照未保存汇率，仍可查看各币种原币金额。</p>}
      </> : <p className="empty-copy">这个月还没有资产记录。首次保存前的日期不会填入资产。</p>}
    </section>
    <div className="history-list">{[...points].reverse().map(point => <details className="card day-card" key={point.day}>
      <summary><span><strong>{point.day}{point.day === today ? ' · 今天' : ''}</strong><small>{point.carried ? `沿用 ${point.snapshot.day}` : '当日最后保存'}</small></span><b className="money">{money(convertedTotal(point.snapshot.totals, currency, point.snapshot.rate), currency)}</b><Icon name="chevron-right" size={17} /></summary>
      <div className="day-detail"><p className="small muted">日元 {money(point.snapshot.totals.JPY, 'JPY')} · 人民币 {money(point.snapshot.totals.CNY, 'CNY')}</p><p className="small muted">{point.snapshot.rate ? `快照汇率：1 CNY = ${point.snapshot.rate.cnyToJpy} JPY（${point.snapshot.rate.date} · ${point.snapshot.rate.source}）` : '此快照没有汇率，跨币种总额暂不可用。'}</p>
        {point.snapshot.assets.map(asset => <div className="snapshot-row" key={asset.id}><span>{asset.source}<small>{money(asset.amountMinor, asset.currency)}</small></span><button className="text-button" onClick={() => onEdit(asset)}>更新为今日余额</button></div>)}
        {!point.snapshot.assets.length && <p className="small muted">当日没有持有资产。</p>}
      </div>
    </details>)}</div>
  </>
}
