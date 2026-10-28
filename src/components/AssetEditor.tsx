import { useEffect, useRef, useState } from 'react'
import type { Asset, Currency, Draft, Rate, Snapshot } from '../domain/ledger'
import { amountInput, convertedTotal, currencyName, localDay, money } from '../domain/ledger'
import { balanceChange, formatMoneyChange, moneyChangeClass } from './balanceChange'
import { Icon } from './Icon'

interface Props {
  asset?: Asset
  history?: { day: string; affectsCurrent: boolean }
  currency: Currency
  rate?: Rate | null
  previous?: Snapshot
  onClose: () => void
  onSave: (draft: Draft) => Promise<void>
  onDelete: (id: string) => Promise<void>
}
export function AssetEditor({ asset, history, currency: initialCurrency, rate = null, previous, onClose, onSave, onDelete }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState(asset?.source ?? '')
  const [currency, setCurrency] = useState<Currency>(asset?.currency ?? initialCurrency)
  const [amount, setAmount] = useState(asset ? amountInput(asset) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = source !== (asset?.source ?? '') || amount !== (asset ? amountInput(asset) : '') || currency !== (asset?.currency ?? initialCurrency)
  const change = asset && !history ? balanceChange(asset, previous) : null
  const previousAmount = asset && change !== null ? asset.amountMinor - change : null
  const changePercent = change !== null && previousAmount !== null && previousAmount !== 0 ? change / Math.abs(previousAmount) * 100 : null
  const percentLabel = changePercent === null ? '—' : `${changePercent > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(changePercent)}%`
  const converted = asset && asset.currency !== initialCurrency ? convertedTotal({ JPY: 0, CNY: 0, [asset.currency]: asset.amountMinor }, initialCurrency, rate) : null
  useEffect(() => {
    dialog.current?.showModal()
    document.body.classList.add('modal-open')
    return () => document.body.classList.remove('modal-open')
  }, [])
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  function close() { if (!busy && (!dirty || window.confirm('放弃尚未保存的修改？'))) onClose() }
  async function submit() {
    setBusy(true); setError('')
    try { await onSave({ id: asset?.id || undefined, source, currency, amount }); onClose() }
    catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); setBusy(false) }
  }
  async function remove() {
    if (!asset?.id || !window.confirm(`从当前资产中删除「${asset.source}」？此前日期的资产快照仍会保留。`)) return
    setBusy(true); setError('')
    try { await onDelete(asset.id); onClose() }
    catch (error) { setError(error instanceof Error ? error.message : '删除失败，请重试。'); setBusy(false) }
  }
  return <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="editor-inner">
      <header className="editor-heading"><button className="icon-button" type="button" aria-label="关闭" onClick={close} disabled={busy}><Icon name="close" /></button><h2 id="editor-title">{history ? '修正历史金额' : asset ? '更新资产余额' : '记录资产'}</h2><span /></header>
      <form onSubmit={event => { event.preventDefault(); void submit() }}>
        <fieldset disabled={busy}>
          <label className="field">资产来源<input autoFocus={!history} readOnly={Boolean(history)} required maxLength={60} value={source} onChange={event => setSource(event.target.value)} /></label>
          <div className="currency-switch compact" role="group" aria-label="本笔资产币种">
            {(['JPY', 'CNY'] as const).map(value => <button key={value} type="button" disabled={Boolean(history)} aria-pressed={currency === value} className={currency === value ? 'selected' : ''} onClick={() => setCurrency(value)}>{currencyName(value)} <small>{value}</small></button>)}
          </div>
          <label className="field amount-input">{history ? `${history.day} 的余额` : '当前余额'} · {currencyName(currency)}<input className={amount.trim().startsWith('-') ? 'negative' : undefined} autoFocus={Boolean(history)} required inputMode="numeric" pattern="-?[0-9]+" placeholder="0" value={amount} onChange={event => setAmount(event.target.value)} aria-describedby="amount-help" /></label>
          <div className="amount-tools"><button className="text-button" type="button" onClick={() => setAmount(value => value.startsWith('-') ? value.slice(1) : `-${value}`)}>切换正负 ±</button><small id="amount-help">整数{currencyName(currency)}，负数表示负债</small></div>
          {asset && !history && <div className="asset-context small muted">
            <p>上次更新：<time dateTime={asset.updatedDay}>{asset.updatedDay}</time></p>
            {previous && <p>较 {previous.day}：{change === null ? '暂无可比记录' : <span className={`money${moneyChangeClass(change)}`}>{formatMoneyChange(change, asset.currency)}（{percentLabel}）</span>}</p>}
            {asset.currency !== initialCurrency && <p>按当前汇率折合：<span className={`money${converted !== null && converted < 0 ? ' negative' : ''}`}>{money(converted, initialCurrency)}</span></p>}
          </div>}
          {history ? <p className="editor-note">修改快照：{history.day}。保留当时汇率，重新计算该日总资产。<br />{history.affectsCurrent ? '这是最近一次快照，当前资产余额也会同步修正。' : '后续已保存的快照和当前资产余额保持不变。'}</p> : <p className="editor-note">保存日期：{localDay()}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" type="submit">{busy ? '正在保存…' : history ? '保存历史修正' : '保存今日余额'}</button>
          {asset?.id && !history && <button className="danger-button" type="button" onClick={() => void remove()}>删除这条资产</button>}
        </fieldset>
      </form>
    </div>
  </dialog>
}
