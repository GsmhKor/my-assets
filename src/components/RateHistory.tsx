import { useEffect, useState } from 'react'
import type { Snapshot } from '../domain/ledger'
import { cachedRateHistory, fetchRateHistory, recentRatePoints, snapshotRatePoints } from '../services/rateHistory'
import type { RatePoint } from '../services/rateHistory'

const dateValue = (day: string) => Date.parse(`${day}T00:00:00Z`)
const amount = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function RateHistory({ snapshots, today, refreshKey }: { snapshots: Snapshot[]; today: string; refreshKey?: string }) {
  const [history, setHistory] = useState<RatePoint[]>(() => cachedRateHistory(today))
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = setTimeout(() => controller.abort(), 12000)
    setLoading(true)
    void fetchRateHistory(controller.signal).then(points => {
      if (active) { setHistory(points); setFailed(false) }
    }).catch(() => { if (active) setFailed(true) }).finally(() => {
      clearTimeout(timeout)
      if (active) setLoading(false)
    })
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [today, refreshKey])

  const onlinePoints = recentRatePoints(history, today)
  const fromSnapshots = onlinePoints.length === 0
  const points = fromSnapshots ? snapshotRatePoints(snapshots, today) : onlinePoints
  const latest = points.at(-1)
  const values = points.map(point => point.cny)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const padding = Math.max((high - low) * 0.15, high * 0.001, 0.05)
  const min = Math.max(0, low - padding)
  const max = high + padding
  const left = 74, right = 458, top = 18, bottom = 194
  const firstDate = points[0]?.day ?? today
  const lastDate = latest?.day ?? today
  const x = (day: string) => firstDate === lastDate ? (left + right) / 2 : left + (dateValue(day) - dateValue(firstDate)) / (dateValue(lastDate) - dateValue(firstDate)) * (right - left)
  const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top)
  return <section className="card rate-history" aria-label="近期汇率曲线">
    <div className="rate-history-heading"><h2>汇率走势</h2><span className="small muted">近 100 天</span></div>
    <p className="small muted">10000 日元可兑换的人民币（元）</p>
    {latest ? <>
      <p className="rate-history-latest money"><strong>{amount(latest.cny)}</strong><span>元 · {latest.day}</span></p>
      <svg viewBox="0 0 480 228" role="img" aria-label={`汇率折线图，${firstDate} 至 ${lastDate}，${points.length} 天记录，最低 ${amount(low)} 元，最高 ${amount(high)} 元`}>
        {Array.from({ length: 5 }, (_, i) => {
          const value = min + (max - min) * i / 4
          return <g key={i}><line className="chart-axis" x1={left} x2={right} y1={y(value)} y2={y(value)} /><text className="chart-tick" x={left - 8} y={y(value) + 3} textAnchor="end">{amount(value)}</text></g>
        })}
        <line className="chart-axis" x1={left} x2={left} y1={top} y2={bottom} />
        <polyline className="chart-line" points={points.map(point => `${x(point.day)},${y(point.cny)}`).join(' ')} />
        {points.length === 1 && <circle cx={x(latest.day)} cy={y(latest.cny)} r="3" fill="var(--accent)" />}
        {points.map(point => <circle key={point.day} cx={x(point.day)} cy={y(point.cny)} r="5" fill="transparent"><title>{point.day} · {amount(point.cny)} 元 / 10000 日元</title></circle>)}
        <text className="chart-tick" x={x(firstDate)} y="216" textAnchor={points.length === 1 ? 'middle' : 'start'}>{firstDate}</text>
        {points.length > 1 && <text className="chart-tick" x={right} y="216" textAnchor="end">{lastDate}</text>}
      </svg>
      <p className="small muted rate-history-note">{fromSnapshots ? '本地快照 · 按快照日期与当时保存的汇率显示' : `Frankfurter · ${points.length} 天报价${failed ? ' · 暂用缓存' : ''}`}{loading ? ' · 更新中…' : ''}</p>
      {points.length === 1 && <p className="small muted">已有 1 天记录，积累后即可连成曲线。</p>}
    </> : <p className="empty-copy" role="status">{loading ? '正在获取历史汇率…' : '暂无可用汇率记录，联网刷新后重试。'}</p>}
  </section>
}
