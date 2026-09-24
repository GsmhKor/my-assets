export type AmountRange = { min: number | null; max: number | null }

const top = 16
const bottom = 138
const breakHeight = 26

// All amounts, including ticks and the omitted interval, use minor currency units.
export function historyScale(ranges: AmountRange[], unit: number) {
  const valid = ranges.filter((range): range is { min: number; max: number } => range.min !== null && range.max !== null)
    .sort((a, b) => a.min - b.min)
  const min = valid.length ? Math.min(...valid.map(range => range.min)) : 0
  const max = valid.length ? Math.max(...valid.map(range => range.max)) : 0
  const variation = valid.reduce((sum, range) => sum + range.max - range.min, 0)
  const padding = Math.max(variation > 0 ? variation * 0.2 : Math.max(Math.abs(min), Math.abs(max)) * 0.002, unit)
  const lower = valid[0]
  const upper = valid[1]
  const gap = valid.length === 2 ? upper.min - lower.max : 0
  // Only omit an empty interval when it would otherwise dominate the chart.
  const useBreak = gap > Math.max(variation, padding * 6)
  const span = useBreak ? variation : max - min
  const rawStep = Math.max(span / 4, padding / 2, unit)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = ([1, 2, 5, 10].find(factor => factor * magnitude >= rawStep) ?? 10) * magnitude
  const bounds = (low: number, high: number) => ({
    min: Math.floor((low - padding) / step) * step,
    max: Math.ceil((high + padding) / step) * step,
  })
  const lowBand = useBreak ? bounds(lower.min, lower.max) : bounds(min, max)
  const highBand = useBreak ? bounds(upper.min, upper.max) : null
  const omitted = highBand && highBand.min - lowBand.max > step * 2
    ? { from: lowBand.max, to: highBand.min } : null
  const full = omitted && highBand ? { min: lowBand.min, max: highBand.max } : bounds(min, max)
  const visibleSpan = full.max - full.min - (omitted ? omitted.to - omitted.from : 0)
  const pixelsPerUnit = (bottom - top - (omitted ? breakHeight : 0)) / visibleSpan
  const y = (value: number) => omitted && value >= omitted.to
    ? top + (full.max - value) * pixelsPerUnit
    : bottom - (value - full.min) * pixelsPerUnit
  const axisBreak = omitted ? { ...omitted, top: y(omitted.to), bottom: y(omitted.from) } : null
  const bands = omitted && highBand ? [lowBand, highBand] : [full]
  const ticks = bands.flatMap(band => [band.min, ...(omitted ? [] : [(band.min + band.max) / 2]), band.max])
  return { y, ticks, axisBreak, top, bottom }
}
