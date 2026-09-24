import { useMemo } from 'react'
import type { Asset, Currency, Ledger } from '../domain/ledger'
import { convertedTotal, currencyName, historyBetween, money } from '../domain/ledger'
import { Icon } from './Icon'
import { balanceChange, formatMoneyChange, moneyChangeClass } from './balanceChange'
import { historyScale } from './historyScale'

const percent = (value: number) => `${value > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`

export function History({ ledger, currency, today, onCorrect, busy = false }: { ledger: Ledger; currency: Currency; today: string; onCorrect: (day: string, asset: Asset) => void; busy?: boolean }) {
  const from = ledger.snapshots[0]?.day ?? today
  const points = useMemo(() => historyBetween(ledger.snapshots, from, today), [ledger.snapshots, from, today])
  const amounts = points.map(point => convertedTotal(point.snapshot.totals, currency, point.snapshot.rate))
  const nativeAmounts = points.map(point => point.snapshot.totals[currency])
  const nativeLabel = `实际${currencyName(currency)}资产`
  const series = [
    { id: 'total', label: '总资产（折算）', amounts },
    { id: 'native', label: nativeLabel, amounts: nativeAmounts },
  ].map(item => {
    const last = item.amounts.at(-1)
    // historyBetween fills every calendar day, including carried snapshots.
    const yesterday = item.amounts.at(-2)
    const dailyChange = yesterday != null && last != null ? last - yesterday : null
    const dailyPercent = dailyChange !== null && yesterday != null && yesterday !== 0 ? dailyChange / Math.abs(yesterday) * 100 : null
    const valid = item.amounts.filter((amount): amount is number => amount !== null)
    return { ...item, last, yesterday, dailyChange, dailyPercent,
      min: valid.length ? Math.min(...valid) : null, max: valid.length ? Math.max(...valid) : null }
  })
  const unit = currency === 'JPY' ? 1 : 100
  const { y, ticks, axisBreak, top, bottom } = historyScale(series, unit)
  const x = (index: number) => 56 + (index / Math.max(points.length - 1, 1)) * 252
  const tickLabel = (value: number) => {
    const amount = value / unit
    const divisor = Math.abs(amount) >= 100_000_000 ? 100_000_000 : Math.abs(amount) >= 10_000 ? 10_000 : 1
    const spacing = Math.min(...ticks.slice(1).map((tick, index) => Math.abs(tick - ticks[index]))) / unit / divisor
    const digits = Math.max(0, Math.min(8, Math.ceil(-Math.log10(spacing)) + 1))
    return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(amount / divisor)}${divisor === 100_000_000 ? '亿' : divisor === 10_000 ? '万' : ''}`
  }
  const path = (values: (number | null)[]) => {
    const segments: { x: number; y: number }[][] = []
    let segment: { x: number; y: number }[] = []
    values.forEach((value, index) => {
      if (value === null) {
        segment = []
        return
      }
      if (segment.length === 0) segments.push(segment)
      segment.push({ x: x(index), y: y(value) })
    })
    return segments.map(segment => {
      const start = `M ${segment[0].x} ${segment[0].y}`
      if (segment.length < 3) {
        return start + (segment[1] ? ` L ${segment[1].x} ${segment[1].y}` : '')
      }
      const slopes = segment.slice(1).map((point, index) =>
        (point.y - segment[index].y) / (point.x - segment[index].x))
      // Monotone cubic interpolation on equally spaced days avoids artificial peaks.
      const tangents = segment.map((_, index) => {
        if (index === 0) return slopes[0]
        if (index === segment.length - 1) return slopes[index - 1]
        const before = slopes[index - 1]
        const after = slopes[index]
        return before * after <= 0 ? 0 : 2 * before * after / (before + after)
      })
      return start + segment.slice(1).map((point, index) => {
        const previous = segment[index]
        const step = (point.x - previous.x) / 3
        return ` C ${previous.x + step} ${previous.y + step * tangents[index]} ${point.x - step} ${point.y - step * tangents[index + 1]} ${point.x} ${point.y}`
      }).join('')
    }).join(' ')
  }
  return <>
    <div className="section-heading"><h1>资产日历</h1>{points.length > 0 && <span className="small muted">共 {points.length} 天</span>}</div>
    <section className="card history-chart"><h2>每日资产变化 · {currency}</h2>
      {points.length ? <>
        <div className="history-summaries">
        {series.map(item => <section className="history-series" aria-label={item.label} key={item.id}>
            <div className="history-series-heading"><h3><i className={`chart-swatch chart-swatch-${item.id}`} aria-hidden="true" />{item.label}</h3><strong className="money">{money(item.last ?? null, currency, 0)}</strong></div>
            <p className="chart-change">较昨日变化 <strong className={`money${moneyChangeClass(item.dailyChange)}`}>{item.yesterday === undefined ? '暂无昨日记录' : formatMoneyChange(item.dailyChange, currency)}</strong>{item.dailyPercent !== null && <span className={`money${moneyChangeClass(item.dailyChange)}`}>（{percent(item.dailyPercent)}）</span>}{item.yesterday === 0 && item.dailyChange !== null && <span title="昨日余额为 0，无法计算变化百分比">（昨日余额为 0）</span>}</p>
            <div className="chart-labels"><span>最高 {money(item.max, currency, 0)}</span><span>最低 {money(item.min, currency, 0)}</span></div>
          </section>
        )}
        </div>
        <svg viewBox="0 0 320 158" role="img" aria-label={`${from} 至 ${today} 总资产与${nativeLabel}金额走势，共用 ${currency} 金额刻度${axisBreak ? `，省略 ${money(axisBreak.from, currency)} 至 ${money(axisBreak.to, currency)} 的无数据区间，上下刻度等比例` : ''}，详细金额见下方日期列表`}>
          {ticks.map(tick => <g key={tick}>
            <path d={`M56 ${y(tick)}H308`} className={tick === 0 ? 'chart-zero' : 'chart-axis'} />
            <text x="48" y={y(tick)} dy="0.35em" textAnchor="end" className="chart-tick"><title>{money(tick, currency)}</title>{tickLabel(tick)}</text>
          </g>)}
          <path d={axisBreak ? `M56 ${top}V${axisBreak.top} M56 ${axisBreak.bottom}V${bottom}` : `M56 ${top}V${bottom}`} className="chart-axis" />
          {axisBreak && <g className="chart-break">
            <title>{`省略 ${money(axisBreak.from, currency)} 至 ${money(axisBreak.to, currency)} 的无数据区间，上下刻度等比例`}</title>
            <path d={`M52 ${axisBreak.top + 9}l8 -4 m-8 10l8 -4 M304 ${axisBreak.top + 9}l8 -4 m-8 10l8 -4`} />
            <text x="182" y={(axisBreak.top + axisBreak.bottom) / 2} dy="0.35em" textAnchor="middle">省略无数据区间 · 等比例</text>
          </g>}
          {series.map(item => <g key={item.id}>
            <path d={path(item.amounts)} className={`chart-line chart-line-${item.id}`} />
            {item.amounts.map((amount, index) => amount !== null && <circle key={points[index].day} cx={x(index)} cy={y(amount)} r={item.id === 'native' ? 2 : 3.5} className={`chart-dot chart-dot-${item.id}`}><title>{`${points[index].day} · ${item.label}：${money(amount, currency, 0)}`}</title></circle>)}
          </g>)}
        </svg>
        <div className="chart-labels history-dates"><span>{points[0].day}</span><span>{points.at(-1)?.day}</span></div>
        {amounts.some(amount => amount === null) && <p className="small muted chart-note">缺少汇率的日期不绘制折算总资产数据，实际余额不受影响。</p>}
      </> : <p className="empty-copy">还没有资产记录。首次保存后会从记录当天开始展示历史。</p>}
    </section>
    <div className="history-list">{[...points].reverse().map((point, index) => {
      const previous = points[points.length - index - 2]?.snapshot
      const total = convertedTotal(point.snapshot.totals, currency, point.snapshot.rate)
      const previousTotal = previous ? convertedTotal(previous.totals, currency, previous.rate) : null
      const totalChange = total !== null && previousTotal !== null ? total - previousTotal : null
      const nativeChange = previous ? point.snapshot.totals[currency] - previous.totals[currency] : null
      const comparison = previous ? `较 ${previous.day}` : '暂无可比记录'
      return <details className="card day-card" key={point.day}>
      <summary><span><strong>{point.day}{point.day === today ? ' · 今天' : ''}</strong><small>{point.carried ? `沿用 ${point.snapshot.day}` : '当日最后保存'}</small></span><b className="money"><small>总资产（折算）</small><span className="money" title={totalChange !== null ? `${comparison} ${formatMoneyChange(totalChange, currency)}` : '暂无可比金额'}>{money(total, currency, 0)}</span><small className="money" title={nativeChange !== null ? `${comparison} ${formatMoneyChange(nativeChange, currency)}` : comparison}>{nativeLabel} {money(point.snapshot.totals[currency], currency, 0)}</small></b><Icon name="chevron-right" size={17} /></summary>
      <div className="day-detail"><p className="small muted"><span className="money">日元 {money(point.snapshot.totals.JPY, 'JPY')}</span> · <span className="money">人民币 {money(point.snapshot.totals.CNY, 'CNY', 0)}</span></p>{previous && <p className="small muted">{comparison}：总资产 <span className="money">{formatMoneyChange(totalChange, currency)}</span> · 实际余额 <span className="money">{formatMoneyChange(nativeChange, currency)}</span></p>}<p className="small muted">{point.snapshot.rate ? <>
        快照汇率<br />
        1 CNY = {point.snapshot.rate.cnyToJpy.toFixed(2)} JPY<br />
        10000 JPY = {(10000 / point.snapshot.rate.cnyToJpy).toFixed(2)} CNY<br />
        （{point.snapshot.rate.date} · {point.snapshot.rate.source}）
      </> : '此快照没有汇率，跨币种总额暂不可用。'}</p>
        {point.snapshot.assets.map(asset => {
          const change = balanceChange(asset, previous)
          return <div className="snapshot-row" key={asset.id}><span>{asset.source}<small className="money" title={change !== null ? `${comparison} ${formatMoneyChange(change, asset.currency)}` : '暂无可比记录'}>{money(asset.amountMinor, asset.currency)}</small></span><button className="text-button" disabled={busy} onClick={() => onCorrect(point.snapshot.day, asset)} aria-label={`修改 ${point.snapshot.day} 快照中 ${asset.source} 的金额`}>{point.carried ? `修改 ${point.snapshot.day} 快照` : '修改历史金额'}</button></div>
        })}
        {!point.snapshot.assets.length && <p className="small muted">当日没有持有资产。</p>}
      </div>
    </details>})}</div>
  </>
}
