import { useMemo, useState } from 'react'
import type { Currency, Ledger } from '../domain/ledger'
import { convertedTotal, currencyName, historyBetween, money, shiftDay } from '../domain/ledger'
import { Icon } from './Icon'

const percent = (value: number) => `${value > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 3 }).format(value)}%`

export function History({ ledger, currency, today }: { ledger: Ledger; currency: Currency; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7))
  const from = `${month}-01`
  const next = new Date(`${from}T12:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const end = shiftDay(next.toISOString().slice(0, 10), -1)
  const to = end < today ? end : today
  const points = useMemo(() => historyBetween(ledger.snapshots, from, to), [ledger.snapshots, from, to])
  const amounts = points.map(point => convertedTotal(point.snapshot.totals, currency, point.snapshot.rate))
  const nativeAmounts = points.map(point => point.snapshot.totals[currency])
  const nativeLabel = `实际${currencyName(currency)}资产`
  const series = [
    { id: 'total', label: '总资产（折算）', amounts },
    { id: 'native', label: nativeLabel, amounts: nativeAmounts },
  ].map(item => {
    const first = item.amounts[0]
    const last = item.amounts.at(-1)
    const valid = item.amounts.filter((amount): amount is number => amount !== null)
    const changes = item.amounts.map(amount => first == null || first === 0 || amount === null ? null : (amount - first) / Math.abs(first) * 100)
    return { ...item, first, changes, change: first != null && last != null ? last - first : null,
      min: valid.length ? Math.min(...valid) : null, max: valid.length ? Math.max(...valid) : null }
  })
  const changes = series.flatMap(item => item.changes).filter((value): value is number => value !== null)
  const minChange = Math.min(0, ...changes)
  const maxChange = Math.max(0, ...changes)
  const x = (index: number) => 18 + (index / Math.max(points.length - 1, 1)) * 284
  const y = (value: number) => maxChange === minChange ? 75 : 130 - (value - minChange) / (maxChange - minChange) * 110
  const path = (values: (number | null)[]) => values.map((value, index) => value === null ? '' : `${index === 0 || values[index - 1] === null ? 'M' : 'L'} ${x(index)} ${y(value)}`).join(' ')
  function move(delta: number) { const date = new Date(`${from}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); setMonth(date.toISOString().slice(0, 7)) }
  return <>
    <div className="section-heading"><h1>资产日历</h1></div>
    <div className="month-switch"><button className="icon-button" aria-label="上个月" disabled={Boolean(ledger.snapshots.length && month <= ledger.snapshots[0].day.slice(0, 7))} onClick={() => move(-1)}><Icon name="chevron-left" /></button><label><span className="sr-only">选择月份</span><input type="month" value={month} min={ledger.snapshots[0]?.day.slice(0, 7)} max={today.slice(0, 7)} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value) }} /></label><button className="icon-button" aria-label="下个月" disabled={month >= today.slice(0, 7)} onClick={() => move(1)}><Icon name="chevron-right" /></button></div>
    <section className="card history-chart"><h2>每日资产变化 · {currency}</h2>
      {points.length ? <>
        <div className="chart-legend">{series.map(item => <span key={item.id}><i className={`chart-swatch chart-swatch-${item.id}`} aria-hidden="true" />{item.label}</span>)}</div>
        {changes.length > 0 && <>
          <svg viewBox="0 0 320 158" role="img" aria-label={`${month}总资产与${nativeLabel}涨跌幅对比，以 ${points[0].day} 为起点，共用百分比刻度，详细金额见下方日期列表`}>
            <path d="M18 20H302 M18 130H302" className="chart-axis" />
            <path d={`M18 ${y(0)}H302`} className="chart-zero" />
            {series.map(item => <g key={item.id}>
              <path d={path(item.changes)} className={`chart-line chart-line-${item.id}`} />
              {item.changes.map((change, index) => change !== null && <circle key={points[index].day} cx={x(index)} cy={y(change)} r={item.id === 'native' ? 2 : 3.5} className={`chart-dot chart-dot-${item.id}`}><title>{`${points[index].day} · ${item.label}：${money(item.amounts[index], currency, 0)} · 较起点 ${percent(change)}`}</title></circle>)}
            </g>)}
          </svg>
          <div className="chart-labels"><span>{points[0].day}</span><span>{points.at(-1)?.day}</span></div>
        </>}
        {series.map(item => <section className="history-series" aria-label={item.label} key={item.id}>
            <h3><i className={`chart-swatch chart-swatch-${item.id}`} aria-hidden="true" />{item.label}</h3>
            <p className="chart-change">区间净变化 <strong className={`money${item.change !== null && item.change < 0 ? ' negative' : ''}`}>{item.change === null ? '待汇率' : `${item.change > 0 ? '+' : ''}${money(item.change, currency, 0)}`}</strong>{item.changes.at(-1) != null && <span>（{percent(item.changes.at(-1)!)}）</span>}</p>
            <div className="chart-labels"><span>最高 {money(item.max, currency, 0)}</span><span>最低 {money(item.min, currency, 0)}</span></div>
            {item.first === 0 && <p className="small muted chart-note">起点余额为 0，无法计算涨跌幅；仍显示金额统计。</p>}
            {item.first == null && <p className="small muted chart-note">起点缺少汇率，暂无法比较涨跌幅；可用日期的金额仍保留。</p>}
            {item.first != null && item.first < 0 && <p className="small muted chart-note">起点为负余额，变化按起点余额的绝对值计算；负债减少显示为正。</p>}
          </section>
        )}
        {amounts.some(amount => amount === null) && <p className="small muted chart-note">缺少汇率的日期不绘制折算总资产数据，实际余额不受影响。</p>}
      </> : <p className="empty-copy">这个月还没有资产记录。首次保存前的日期不会填入资产。</p>}
    </section>
    <div className="history-list">{[...points].reverse().map(point => <details className="card day-card" key={point.day}>
      <summary><span><strong>{point.day}{point.day === today ? ' · 今天' : ''}</strong><small>{point.carried ? `沿用 ${point.snapshot.day}` : '当日最后保存'}</small></span><b className="money"><small>总资产（折算）</small>{money(convertedTotal(point.snapshot.totals, currency, point.snapshot.rate), currency, 0)}<small>{nativeLabel} {money(point.snapshot.totals[currency], currency, 0)}</small></b><Icon name="chevron-right" size={17} /></summary>
      <div className="day-detail"><p className="small muted">日元 {money(point.snapshot.totals.JPY, 'JPY')} · 人民币 {money(point.snapshot.totals.CNY, 'CNY', 0)}</p><p className="small muted">{point.snapshot.rate ? `快照汇率：1 CNY = ${point.snapshot.rate.cnyToJpy} JPY（${point.snapshot.rate.date} · ${point.snapshot.rate.source}）` : '此快照没有汇率，跨币种总额暂不可用。'}</p>
        {point.snapshot.assets.map(asset => <div className="snapshot-row" key={asset.id}><span>{asset.source}<small>{money(asset.amountMinor, asset.currency)}</small></span></div>)}
        {!point.snapshot.assets.length && <p className="small muted">当日没有持有资产。</p>}
      </div>
    </details>)}</div>
  </>
}
