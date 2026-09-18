import { useMemo, useState } from 'react'
import type { Asset, Currency, Ledger } from '../domain/ledger'
import { convertedTotal, currencyName, historyBetween, money, shiftDay } from '../domain/ledger'
import { Icon } from './Icon'
import { balanceChange, moneyChangeClass } from './balanceChange'

const percent = (value: number) => `${value > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`

export function History({ ledger, currency, today, onCorrect, busy = false }: { ledger: Ledger; currency: Currency; today: string; onCorrect: (day: string, asset: Asset) => void; busy?: boolean }) {
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
            <p className="chart-change">区间净变化 <strong className={`money${moneyChangeClass(item.change)}`}>{item.change === null ? '待汇率' : `${item.change > 0 ? '+' : ''}${money(item.change, currency, 0)}`}</strong>{item.changes.at(-1) != null && <span className={`money${moneyChangeClass(item.change)}`}>（{percent(item.changes.at(-1)!)}）</span>}</p>
            <div className="chart-labels"><span>最高 {money(item.max, currency, 0)}</span><span>最低 {money(item.min, currency, 0)}</span></div>
            {item.first === 0 && <p className="small muted chart-note">起点余额为 0，无法计算涨跌幅；仍显示金额统计。</p>}
            {item.first == null && <p className="small muted chart-note">起点缺少汇率，暂无法比较涨跌幅；可用日期的金额仍保留。</p>}
            {item.first != null && item.first < 0 && <p className="small muted chart-note">起点为负余额，变化按起点余额的绝对值计算；负债减少显示为正。</p>}
          </section>
        )}
        {amounts.some(amount => amount === null) && <p className="small muted chart-note">缺少汇率的日期不绘制折算总资产数据，实际余额不受影响。</p>}
      </> : <p className="empty-copy">这个月还没有资产记录。首次保存前的日期不会填入资产。</p>}
    </section>
    <div className="history-list">{[...points].reverse().map(point => {
      const previous = ledger.snapshots.findLast(snapshot => snapshot.day < point.day)
      const total = convertedTotal(point.snapshot.totals, currency, point.snapshot.rate)
      const previousTotal = previous ? convertedTotal(previous.totals, currency, previous.rate) : null
      const totalChange = total !== null && previousTotal !== null ? total - previousTotal : null
      const nativeChange = previous ? point.snapshot.totals[currency] - previous.totals[currency] : null
      const comparison = previous ? `较 ${previous.day}` : '暂无可比记录'
      return <details className="card day-card" key={point.day}>
      <summary><span><strong>{point.day}{point.day === today ? ' · 今天' : ''}</strong><small>{point.carried ? `沿用 ${point.snapshot.day}` : '当日最后保存'}</small></span><b className="money"><small>总资产（折算）</small><span className={`money${moneyChangeClass(totalChange)}`} title={totalChange !== null ? `${comparison} ${totalChange > 0 ? '+' : ''}${money(totalChange, currency)}` : '暂无可比金额'}>{money(total, currency, 0)}</span><small className={`money${moneyChangeClass(nativeChange)}`} title={nativeChange !== null ? `${comparison} ${nativeChange > 0 ? '+' : ''}${money(nativeChange, currency)}` : comparison}>{nativeLabel} {money(point.snapshot.totals[currency], currency, 0)}</small></b><Icon name="chevron-right" size={17} /></summary>
      <div className="day-detail"><p className="small muted"><span className={`money${moneyChangeClass(previous ? point.snapshot.totals.JPY - previous.totals.JPY : null)}`}>日元 {money(point.snapshot.totals.JPY, 'JPY')}</span> · <span className={`money${moneyChangeClass(previous ? point.snapshot.totals.CNY - previous.totals.CNY : null)}`}>人民币 {money(point.snapshot.totals.CNY, 'CNY', 0)}</span></p>{previous && <p className="small muted">{comparison}：总资产 <span className={`money${moneyChangeClass(totalChange)}`}>{totalChange === null ? '待汇率' : `${totalChange > 0 ? '+' : ''}${money(totalChange, currency)}`}</span> · 实际余额 <span className={`money${moneyChangeClass(nativeChange)}`}>{nativeChange! > 0 ? '+' : ''}{money(nativeChange, currency)}</span></p>}<p className="small muted">{point.snapshot.rate ? <>
        快照汇率<br />
        1 CNY = {point.snapshot.rate.cnyToJpy.toFixed(2)} JPY<br />
        10000 JPY = {(10000 / point.snapshot.rate.cnyToJpy).toFixed(2)} CNY<br />
        （{point.snapshot.rate.date} · {point.snapshot.rate.source}）
      </> : '此快照没有汇率，跨币种总额暂不可用。'}</p>
        {point.snapshot.assets.map(asset => {
          const change = balanceChange(asset, previous)
          return <div className="snapshot-row" key={asset.id}><span>{asset.source}<small className={`money${moneyChangeClass(change)}`} title={change !== null ? `${comparison} ${change > 0 ? '+' : ''}${money(change, asset.currency)}` : '暂无可比记录'}>{money(asset.amountMinor, asset.currency)}</small></span><button className="text-button" disabled={busy} onClick={() => onCorrect(point.snapshot.day, asset)} aria-label={`修改 ${point.snapshot.day} 快照中 ${asset.source} 的金额`}>{point.carried ? `修改 ${point.snapshot.day} 快照` : '修改历史金额'}</button></div>
        })}
        {!point.snapshot.assets.length && <p className="small muted">当日没有持有资产。</p>}
      </div>
    </details>})}</div>
  </>
}
