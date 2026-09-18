import { useMemo, useState } from 'react'
import type { Asset, Currency, Ledger } from '../domain/ledger'
import { convertedTotal, currencyName, historyBetween, money, shiftDay } from '../domain/ledger'
import { Icon } from './Icon'

export function History({ ledger, currency, today, onEdit, onCorrect, busy = false }: { ledger: Ledger; currency: Currency; today: string; onEdit: (asset: Asset) => void; onCorrect: (day: string, asset: Asset) => void; busy?: boolean }) {
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
  ]
  const x = (index: number) => 18 + (index / Math.max(points.length - 1, 1)) * 284
  function move(delta: number) { const date = new Date(`${from}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); setMonth(date.toISOString().slice(0, 7)) }
  return <>
    <div className="section-heading"><h1>资产日历</h1></div>
    <div className="month-switch"><button className="icon-button" aria-label="上个月" disabled={Boolean(ledger.snapshots.length && month <= ledger.snapshots[0].day.slice(0, 7))} onClick={() => move(-1)}><Icon name="chevron-left" /></button><label><span className="sr-only">选择月份</span><input type="month" value={month} min={ledger.snapshots[0]?.day.slice(0, 7)} max={today.slice(0, 7)} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value) }} /></label><button className="icon-button" aria-label="下个月" disabled={month >= today.slice(0, 7)} onClick={() => move(1)}><Icon name="chevron-right" /></button></div>
    <section className="card history-chart"><h2>每日资产变化 · {currency}</h2>
      {points.length ? <>
        <p className="small muted">总资产包含另一币种的折算金额；实际资产仅统计{currencyName(currency)}余额。</p>
        <p className="small muted chart-note">上下图日期对齐，金额刻度独立；变化幅度请看各自的区间净变化。</p>
        {series.map(item => {
          const valid = item.amounts.filter((amount): amount is number => amount !== null)
          const min = valid.length ? Math.min(...valid) : null
          const max = valid.length ? Math.max(...valid) : null
          const first = item.amounts[0]
          const last = item.amounts.at(-1)
          const change = first != null && last != null ? last - first : null
          const y = (amount: number) => min === null || max === null || max === min ? 75 : 130 - (amount - min) / (max - min) * 110
          const path = item.amounts.map((amount, index) => amount === null ? '' : `${index === 0 || item.amounts[index - 1] === null ? 'M' : 'L'} ${x(index)} ${y(amount)}`).join(' ')
          return <section className="history-series" aria-label={item.label} key={item.id}>
            <h3><i className={`chart-swatch chart-swatch-${item.id}`} aria-hidden="true" />{item.label}</h3>
            {valid.length ? <>
              <p className="chart-change">区间净变化 <strong className={`money${change !== null && change < 0 ? ' negative' : ''}`}>{change === null ? '待汇率' : `${change > 0 ? '+' : ''}${money(change, currency, 0)}`}</strong></p>
              <div className="chart-labels"><span>最高 {money(max, currency, 0)}</span><span>最低 {money(min, currency, 0)}</span></div>
              <svg viewBox="0 0 320 158" role="img" aria-label={`${month}${item.label}折线图，单位 ${currency}，独立金额刻度，最高 ${money(max, currency, 0)}，最低 ${money(min, currency, 0)}，详细金额见下方日期列表`}>
                <path d="M18 140H302" className="chart-axis" />
                <path d={path} className={`chart-line chart-line-${item.id}`} />
                {item.amounts.map((amount, index) => amount !== null && <circle key={points[index].day} cx={x(index)} cy={y(amount)} r="3" className={`chart-dot chart-dot-${item.id}`}><title>{`${points[index].day} · ${item.label}：${money(amount, currency, 0)}`}</title></circle>)}
              </svg>
              <div className="chart-labels"><span>{points[0].day}</span><span>{points.at(-1)?.day}</span></div>
            </> : <p className="small muted">缺少汇率，暂无法显示折算总资产走势。</p>}
          </section>
        })}
        {amounts.some(amount => amount === null) && <p className="small muted chart-note">部分日期缺少汇率，折算总资产暂不可用；实际资产仍正常显示。</p>}
      </> : <p className="empty-copy">这个月还没有资产记录。首次保存前的日期不会填入资产。</p>}
    </section>
    <div className="history-list">{[...points].reverse().map(point => <details className="card day-card" key={point.day}>
      <summary><span><strong>{point.day}{point.day === today ? ' · 今天' : ''}</strong><small>{point.carried ? `沿用 ${point.snapshot.day}` : '当日最后保存'}</small></span><b className="money"><small>总资产（折算）</small>{money(convertedTotal(point.snapshot.totals, currency, point.snapshot.rate), currency, 0)}<small>{nativeLabel} {money(point.snapshot.totals[currency], currency, 0)}</small></b><Icon name="chevron-right" size={17} /></summary>
      <div className="day-detail"><p className="small muted">日元 {money(point.snapshot.totals.JPY, 'JPY')} · 人民币 {money(point.snapshot.totals.CNY, 'CNY', 0)}</p><p className="small muted">{point.snapshot.rate ? `快照汇率：1 CNY = ${point.snapshot.rate.cnyToJpy} JPY（${point.snapshot.rate.date} · ${point.snapshot.rate.source}）` : '此快照没有汇率，跨币种总额暂不可用。'}</p>
        {point.snapshot.assets.map(asset => <div className="snapshot-row" key={asset.id}><span>{asset.source}<small>{money(asset.amountMinor, asset.currency)}</small></span><div className="snapshot-actions"><button className="text-button" disabled={busy} onClick={() => onCorrect(point.snapshot.day, asset)} aria-label={`修改 ${point.snapshot.day} 快照中 ${asset.source} 的金额`}>{point.carried ? `修改 ${point.snapshot.day} 快照` : '修改历史金额'}</button><button className="text-button" disabled={busy} onClick={() => onEdit(asset)}>更新为今日余额</button></div></div>)}
        {!point.snapshot.assets.length && <p className="small muted">当日没有持有资产。</p>}
      </div>
    </details>)}</div>
  </>
}
