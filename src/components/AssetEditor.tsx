import { useEffect, useRef, useState } from 'react'
import type { Asset, Currency, Draft } from '../domain/ledger'
import { amountInput, currencyName, localDay } from '../domain/ledger'
import { Icon } from './Icon'

interface Props {
  asset?: Asset
  currency: Currency
  onClose: () => void
  onSave: (draft: Draft) => Promise<void>
  onDelete: (id: string) => Promise<void>
}
export function AssetEditor({ asset, currency: initialCurrency, onClose, onSave, onDelete }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState(asset?.source ?? '')
  const [currency, setCurrency] = useState<Currency>(asset?.currency ?? initialCurrency)
  const [amount, setAmount] = useState(asset ? amountInput(asset) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = source !== (asset?.source ?? '') || amount !== (asset ? amountInput(asset) : '') || currency !== (asset?.currency ?? initialCurrency)
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
      <header className="editor-heading"><button className="icon-button" type="button" aria-label="关闭" onClick={close} disabled={busy}><Icon name="close" /></button><h2 id="editor-title">{asset ? '更新资产余额' : '记一笔资产'}</h2><span /></header>
      <form onSubmit={event => { event.preventDefault(); void submit() }}>
        <fieldset disabled={busy}>
          <label className="field">资产来源<input autoFocus required maxLength={60} placeholder="自己填写，例如支付宝、银行、现金" value={source} onChange={event => setSource(event.target.value)} /></label>
          <div className="currency-switch compact" role="group" aria-label="本笔资产币种">
            {(['JPY', 'CNY'] as const).map(value => <button key={value} type="button" aria-pressed={currency === value} className={currency === value ? 'selected' : ''} onClick={() => setCurrency(value)}>{currencyName(value)} <small>{value}</small></button>)}
          </div>
          <label className="field amount-input">当前余额 · {currencyName(currency)}<input required inputMode="decimal" placeholder="0" value={amount} onChange={event => setAmount(event.target.value)} aria-describedby="amount-help" /></label>
          <div className="amount-tools"><button className="text-button" type="button" onClick={() => setAmount(value => value.startsWith('-') ? value.slice(1) : `-${value}`)}>切换正负 ±</button><small id="amount-help">{currency === 'JPY' ? '整数日元' : '最多两位小数'}，负数表示负债</small></div>
          <p className="editor-note">保存日期：{localDay()}</p>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" type="submit">{busy ? '正在保存…' : '保存今日余额'}</button>
          {asset?.id && <button className="danger-button" type="button" onClick={() => void remove()}>删除这条资产</button>}
        </fieldset>
      </form>
    </div>
  </dialog>
}
