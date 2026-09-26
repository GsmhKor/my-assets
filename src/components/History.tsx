import { useMemo } from 'react'
import type { Asset, Currency, Ledger } from '../domain/ledger'
import { convertedTotal, currencyName, historyBetween, money } from '../domain/ledger'
import { HistoryList } from './HistoryList'
import { formatMoneyChange, moneyChangeClass } from './balanceChange'
import { historyScale } from './historyScale'

const percent = (value: number) => `${value > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`

export function History({ ledger, currency, today, onCorrect, busy = false }: { ledger: Ledger; currency: Currency; today: string; onCorrect: (day: string, asset: Asset) => void; busy?: boolean }) {
  const from = ledger.snapshots[0]?.day ?? today
  const points = useMemo(() => historyBetween(ledger.snapshots, from, today), [ledger.snapshots, from, today])
  const amounts = points.map(point => convertedTotal(point.snapshot.totals, currency, point.snapshot.rate))
  const nativeAmounts = points.map(point => point.snapshot.totals[currency])
  const nativeLabel = `实际${currencyName(currency)}资产`
  const latestTotal = amounts.at(-1)
  const latestNative = nativeAmounts.at(-1)
  const nativeShare = latestTotal != null && latestTotal !== 0 && latestNative != null
    ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(latestNative / latestTotal * 100)}%`
    : '—'
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
            <div className="history-series-heading"><h3><i className={`chart-swatch chart-swatch-${item.id}`} aria-hidden="true" /><span>{item.label}{item.id === 'native' && <span title="占当日同币种折算总资产的比例">({nativeShare})</span>}</span></h3><strong className="money">{money(item.last ?? null, currency, 0)}</strong></div>
            <p className="chart-change"><span>较昨日变化</span><span className="chart-change-values"><strong className={`money${moneyChangeClass(item.dailyChange)}`}>{item.yesterday === undefined ? '暂无昨日记录' : formatMoneyChange(item.dailyChange, currency, { showCurrency: false })}</strong>{item.dailyPercent !== null && <span className={`money${moneyChangeClass(item.dailyChange)}`}>（{percent(item.dailyPercent)}）</span>}{item.yesterday === 0 && item.dailyChange !== null && <span title="昨日余额为 0，无法计算变化百分比">（昨日余额为 0）</span>}</span></p>
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
            <path d={`M56 ${axisBreak.top + 4}V${axisBreak.bottom - 4}`} />
          </g>}
          {series.map(item => <g key={item.id}>
            <path d={path(item.amounts)} className={`chart-line chart-line-${item.id}`} />
          </g>)}
        </svg>
        <div className="chart-labels history-dates"><span>{points[0].day}</span><span>{points.at(-1)?.day}</span></div>
        {amounts.some(amount => amount === null) && <p className="small muted chart-note">缺少汇率的日期不绘制折算总资产数据，实际余额不受影响。</p>}
      </> : <p className="empty-copy">还没有资产记录。首次保存后会从记录当天开始展示历史。</p>}
    </section>
    <HistoryList points={points} currency={currency} today={today} onCorrect={onCorrect} busy={busy} />
  </>
}
