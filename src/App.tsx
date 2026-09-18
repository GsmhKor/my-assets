import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AssetEditor } from './components/AssetEditor'
import { History } from './components/History'
import { Icon } from './components/Icon'
import { EMPTY_LEDGER, convertedTotal, correctSnapshotAmount, currencyName, localDay, money, recordSnapshot, removeAsset, saveAsset, shiftDay, sumAssets, validRate } from './domain/ledger'
import type { Asset, Currency, Draft, Ledger, Rate } from './domain/ledger'
import { changeLedger, readLedger } from './services/database'
import { cachedRate, cacheRate, fetchRate } from './services/rates'
import { downloadBackup, parseBackup } from './services/backup'
import homeCat from './assets/cat-tab-home.png'
import assetsCat from './assets/cat-tab-bills.png'
import historyCat from './assets/cat-tab-stats.png'
import settingsCat from './assets/cat-tab-settings.png'
import emptyAssetsCat from './assets/cat-empty-bills.webp'
import settingsPrivacyCat from './assets/cat-settings-privacy.webp'
import './App.css'

type Tab = 'home' | 'assets' | 'history' | 'settings'
const tabs: { id: Tab; label: string; image?: string }[] = [{ id: 'home', label: '首页', image: homeCat }, { id: 'assets', label: '资产', image: assetsCat }, { id: 'history', label: '历史', image: historyCat }, { id: 'settings', label: '设置', image: settingsCat }]
function preference(key: string, fallback: string) { try { return localStorage.getItem(`my-assets-${key}`) ?? fallback } catch { return fallback } }
function remember(key: string, value: string) { try { localStorage.setItem(`my-assets-${key}`, value) } catch { /* storage may be unavailable */ } }
function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。' }

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const ledgerRef = useRef<Ledger | null>(null)
  const [loadError, setLoadError] = useState('')
  const [currency, setCurrency] = useState<Currency>(() => preference('currency', 'JPY') === 'CNY' ? 'CNY' : 'JPY')
  const [dark, setDark] = useState(() => preference('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') === 'dark')
  const [rate, setRate] = useState<Rate | null>(cachedRate)
  const [rateBusy, setRateBusy] = useState(false)
  const ratePending = useRef(false)
  const [rateError, setRateError] = useState('')
  const [today, setToday] = useState(localDay)
  const [editor, setEditor] = useState<{ asset?: Asset; revision: number; history?: { day: string; through: string; affectsCurrent: boolean } } | null>(null)
  const [busy, setBusy] = useState(false)
  const mutationPending = useRef(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [manualRate, setManualRate] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({ onRegisteredSW(_url, registration) {
    if (registration) document.addEventListener('visibilitychange', () => { if (!document.hidden) void registration.update().catch(() => {}) })
  } })
  const reload = useCallback(async () => {
    try { const value = await readLedger(); ledgerRef.current = value; setLedger(value); setLoadError('') }
    catch { setLoadError('无法读取本地资产。请重试；已有数据不会被清空。') }
  }, [])
  const mutate = useCallback(async (transform: (value: Ledger) => Ledger, revision = ledgerRef.current?.revision) => {
    if (revision === undefined || mutationPending.current) throw new Error('正在处理其他操作，请稍后再试。')
    mutationPending.current = true; setBusy(true)
    try {
      const value = await changeLedger(revision, transform)
      ledgerRef.current = value; setLedger(value); setToday(localDay()); channel.current?.postMessage('changed')
    } catch (error) { await reload(); throw error }
    finally { mutationPending.current = false; setBusy(false) }
  }, [reload])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const instance = new BroadcastChannel('my-assets-changes'); channel.current = instance
    instance.onmessage = () => { void reload() }
    return () => { instance.close(); channel.current = null }
  }, [reload])
  const refreshRate = useCallback(async (syncToday = false) => {
    if (ratePending.current || mutationPending.current) return
    ratePending.current = true; setRateBusy(true)
    try {
      let next: Rate
      try { next = await fetchRate() }
      catch { setRateError('联网更新失败。有缓存时继续使用上次汇率，也可在设置中手动填写。'); return }
      if (syncToday && ledgerRef.current?.snapshots.length) {
        try { await mutate(value => recordSnapshot(value, value.assets, next)) }
        catch (error) { setRateError(`刷新未完成，今日历史未更新：${errorText(error)}`); return }
      }
      cacheRate(next); setRate(next); setRateError(''); setToday(localDay())
    }
    finally { ratePending.current = false; setRateBusy(false) }
  }, [mutate])
  useEffect(() => {
    void refreshRate()
    const foreground = () => { setToday(localDay()); if (!document.hidden) { void reload(); void refreshRate() } }
    const clock = window.setInterval(() => setToday(localDay()), 30000)
    const interval = window.setInterval(() => { if (!document.hidden) void refreshRate() }, 15 * 60000)
    document.addEventListener('visibilitychange', foreground); window.addEventListener('online', foreground)
    return () => { clearInterval(clock); clearInterval(interval); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('online', foreground) }
  }, [refreshRate, reload])
  useEffect(() => { remember('currency', currency) }, [currency])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; remember('theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 6500); return () => clearTimeout(timer) }, [message])
  function edit(asset?: Asset) { if (ledger && !busy) setEditor({ asset, revision: ledger.revision }) }
  function editHistorical(asset: Asset) {
    const existing = ledger?.assets.find(item => item.id === asset.id)
    edit({ ...asset, id: existing?.id ?? '' })
  }
  function correctHistorical(day: string, asset: Asset) {
    if (!ledger || busy) return
    const next = ledger.snapshots.find(snapshot => snapshot.day > day)
    setEditor({ asset, revision: ledger.revision, history: { day, through: next ? shiftDay(next.day, -1) : localDay(), affectsCurrent: !next } })
  }
  async function save(draft: Draft) {
    if (editor?.history && editor.asset) {
      const { day } = editor.history
      const assetId = editor.asset.id
      await mutate(value => correctSnapshotAmount(value, day, assetId, draft.amount), editor.revision)
      setMessage(`已修正 ${day} 的历史金额与总资产。`)
    } else {
      await mutate(value => saveAsset(value, draft, rate), editor?.revision)
      setMessage('已保存今日余额与总资产快照。')
    }
  }
  async function remove(id: string) { await mutate(value => removeAsset(value, id, rate), editor?.revision); setMessage('已从当前资产移除，之前的快照仍保留。') }
  async function restore(file: File) {
    const revision = ledgerRef.current?.revision
    try {
      if (file.size > 20_000_000) throw new Error('请选择小于 20 MB 的备份。')
      const restored = parseBackup(await file.text())
      if (!window.confirm(`备份包含 ${restored.assets.length} 项资产、${restored.snapshots.length} 天快照。恢复将覆盖本应用当前的全部资产与历史，是否继续？`)) return
      await mutate(() => restored, revision); setMessage('备份已恢复。')
    } catch (error) { setMessage(errorText(error)) }
  }
  async function clear() {
    if (!window.confirm('清空资金账本的全部资产和历史快照？请先导出备份。')) return
    if (!window.confirm('再次确认：这会永久删除当前资金账本的数据。')) return
    try { await mutate(() => structuredClone(EMPTY_LEDGER)); setMessage('资金账本数据已清空。') } catch (error) { setMessage(errorText(error)) }
  }
  const totals = sumAssets(ledger?.assets ?? [])
  const total = convertedTotal(totals, currency, rate)
  const visibleAssets = (ledger?.assets ?? []).filter(asset => asset.source.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  function assetRows(rows: Asset[]) {
    return rows.map(asset => <button className="asset-row" key={asset.id} disabled={busy} onClick={() => edit(asset)} aria-label={`编辑 ${asset.source} ${asset.currency}`}>
      <span className={`currency-badge ${asset.currency.toLowerCase()}`}>{asset.currency === 'JPY' ? '日' : '元'}</span><span className="asset-copy"><strong>{asset.source}</strong><small>{currencyName(asset.currency)} · 更新于 {asset.updatedDay}</small></span><span className={`asset-money money${asset.amountMinor < 0 ? ' negative' : ''}`}>{money(asset.amountMinor, asset.currency)}<small>{asset.currency !== currency ? `≈ ${money(convertedTotal({ JPY: 0, CNY: 0, [asset.currency]: asset.amountMinor }, currency, rate), currency)}` : '点击更新余额'}</small></span><Icon name="chevron-right" size={15} />
    </button>)
  }
  return <div className="app-shell">
    <main className="page">
      <header className="app-header"><div className="brand"><img src={`${import.meta.env.BASE_URL}pwa-192x192.png`} alt="" /><div><strong>资金账本</strong></div></div><span className="local-badge">本地保存</span></header>
      {needRefresh && !editor && <div className="notice">新版本已就绪<button className="text-button" disabled={busy} onClick={() => void updateServiceWorker(true)}>更新应用</button></div>}
      {loadError ? <div className="card error-message" role="alert">{loadError}<button className="primary-button" onClick={() => void reload()}>重新读取</button></div> : !ledger ? <p className="empty-copy" role="status">正在打开资金账本…</p> : <>
        {(tab === 'home' || tab === 'history') && <div className="currency-switch" role="group" aria-label="登记与统计币种">{(['JPY', 'CNY'] as const).map(value => <button key={value} aria-pressed={currency === value} className={currency === value ? 'selected' : ''} onClick={() => setCurrency(value)}><span>{currencyName(value)}</span><small>{value}</small></button>)}</div>}
        {tab === 'home' && <>
          <section className="balance-card" aria-label="当前总资产"><p className="eyebrow">我的总资产 · {currencyName(currency)}</p><strong className={`balance-value money${(total ?? 0) < 0 ? ' negative' : ''}`} data-testid="total">{money(total, currency, 0)}</strong><div className="native-totals"><div><span>日元资产</span><b className="money">{money(totals.JPY, 'JPY')}</b></div><div><span>人民币资产</span><b className="money">{money(totals.CNY, 'CNY', 0)}</b></div></div></section>
          <div className="rate-panel"><div><strong>{rate ? <>1 人民币 = {rate.cnyToJpy.toFixed(4)} 日元<br />10000 日元 = {(10000 / rate.cnyToJpy).toFixed(2)} 人民币</> : '正在等待可用汇率'}</strong><small>{rate ? `${rate.source} · 报价 ${rate.date} · 获取 ${new Date(rate.fetchedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '没有汇率时，仍可保存原币余额。'}</small></div><button className="text-button" disabled={rateBusy || busy} onClick={() => void refreshRate(true)}>{rateBusy ? '更新中…' : '刷新'}</button></div>
          {rateError && <p className="notice small" role="status">{rateError}</p>}
          {total === null && <p className="notice small">缺少汇率，暂不能合并两种币种；请刷新或在设置中填写汇率。</p>}
        </>}
        {tab === 'assets' && <>
          <label className="search"><Icon name="search" size={18} /><input aria-label="搜索资产来源" placeholder="搜索资产来源" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="section-heading"><h2>资产明细 <small>{ledger.assets.length} 项</small></h2></div>
          <section className="card assets-list">{visibleAssets.length ? assetRows(visibleAssets) : <div className="empty"><img src={emptyAssetsCat} alt="" /><h2>{search ? '没有找到这个来源' : '从第一份资产开始'}</h2><p>{search ? '试试其他关键词。' : '点击右下角猫咪，填写来源和当前余额。'}</p>{!search && <button className="text-button" onClick={() => edit()}>记一笔资产</button>}</div>}</section>
        </>}
        {tab === 'history' && <History ledger={ledger} currency={currency} today={today} onEdit={editHistorical} onCorrect={correctHistorical} busy={busy} />}
        {tab === 'settings' && <>
          <div className="section-heading"><h1>设置</h1></div>
          <section className="card privacy"><img src={settingsPrivacyCat} alt="" /><div><h2>资产只保存在这里</h2><p>金额和来源留在本设备。联网仅查询汇率，请定期备份。</p></div></section>
          <h2 className="settings-heading">数据与备份</h2><section className="card settings-list"><button onClick={() => downloadBackup(ledger)} disabled={busy}><Icon name="download" /><span>导出完整 JSON 备份<small>包括资产、每日快照和历史汇率</small></span></button><button disabled={busy} onClick={() => importInput.current?.click()}><Icon name="upload" /><span>从备份恢复<small>覆盖当前资金账本的数据</small></span></button><input ref={importInput} type="file" hidden accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void restore(file) }} /></section>
          <h2 className="settings-heading">外观</h2><section className="card settings-list"><label className="setting-row"><Icon name="moon" /><span>深色模式</span><input type="checkbox" role="switch" checked={dark} onChange={event => setDark(event.target.checked)} /></label></section>
          <h2 className="settings-heading">汇率</h2><section className="card rate-settings"><p>自动获取 Frankfurter 最新参考价；断网时使用上次汇率。历史快照始终保留保存时的汇率。</p><form onSubmit={event => { event.preventDefault(); const next: Rate = { cnyToJpy: Number(manualRate), date: localDay(), fetchedAt: new Date().toISOString(), source: '手动' }; if (!validRate(next)) { setMessage('请输入 0.01～1000 之间的有效汇率。'); return } setRate(next); cacheRate(next); setRateError(''); setMessage('手动汇率已应用。下次自动更新成功时使用联网报价。') }}><label className="field">手动填写：1 人民币等于多少日元<input inputMode="decimal" placeholder="例如 20.00" value={manualRate} onChange={event => setManualRate(event.target.value)} /></label><button className="secondary-button" disabled={rateBusy}>使用此汇率</button></form><a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">查看汇率来源</a></section>
          <h2 className="settings-heading">数据管理</h2><section className="card settings-list"><button className="negative" disabled={busy || !ledger.snapshots.length} onClick={() => void clear()}><Icon name="trash" /><span>清空全部资产及历史<small>此操作需要两次确认</small></span></button></section><p className="app-info">资金账本 · {__APP_VERSION__}<br />日元 / 人民币 · 本地保存</p>
        </>}
      </>}
    </main>
    {ledger && !loadError && tab !== 'settings' && <button className="floating-add" onClick={() => edit()} disabled={busy} aria-label="记一笔" title="记一笔资产" />}
    <nav className="tab-bar" aria-label="主导航">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setSearch('') }}>{item.image ? <img src={item.image} alt="" /> : <Icon name="settings" size={28} />}<span>{item.label}</span></button>)}</nav>
    {editor && <AssetEditor asset={editor.asset} history={editor.history} currency={currency} onClose={() => setEditor(null)} onSave={save} onDelete={remove} />}
    {message && <div className="toast" role="status">{message}</div>}
  </div>
}
