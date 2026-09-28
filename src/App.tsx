import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AssetEditor } from './components/AssetEditor'
import { History } from './components/History'
import { TotalBalance } from './components/TotalBalance'
import { RateHistory } from './components/RateHistory'
import { Icon } from './components/Icon'
import { balanceChange, formatMoneyChange, moneyChangeClass } from './components/balanceChange'
import { convertedTotal, correctSnapshotAmount, currencyName, localDay, money, recordSnapshot, removeAsset, saveAsset, shiftDay, sumAssets, validRate } from './domain/ledger'
import type { Asset, Currency, Draft, Ledger, Rate } from './domain/ledger'
import { assetSortPreference, sortAssetsByAmount } from './domain/assetSort'
import type { AssetSortOrder } from './domain/assetSort'
import { changeLedger, readLedger } from './services/database'
import { cachedRate, cacheRate, fetchRate } from './services/rates'
import { downloadBackup, parseBackup } from './services/backup'
import { activateAppUpdate, checkForAppUpdate } from './services/appUpdate'
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
  const [dark, setDark] = useState(() => preference('theme', 'dark') === 'dark')
  const [rate, setRate] = useState<Rate | null>(cachedRate)
  const [rateBusy, setRateBusy] = useState(false)
  const ratePending = useRef(false)
  const [rateError, setRateError] = useState('')
  const [today, setToday] = useState(localDay)
  const [editor, setEditor] = useState<{ asset?: Asset; revision: number; history?: { day: string; through: string; affectsCurrent: boolean } } | null>(null)
  const [saving, setBusy] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const checkUpdatePending = useRef(false)
  const updatePending = useRef(false)
  const [updateError, setUpdateError] = useState('')
  const [activatedUpdate, setActivatedUpdate] = useState(false)
  const [swRegistration, setSWRegistration] = useState<ServiceWorkerRegistration>()
  const busy = saving || updating
  const mutationPending = useRef(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [assetSort, setAssetSort] = useState<AssetSortOrder>(() => assetSortPreference(preference('asset-sort', 'default')))
  const importInput = useRef<HTMLInputElement>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const { needRefresh: [needRefresh, setNeedRefresh] } = useRegisterSW({
    onRegisteredSW(_url, registration) { setSWRegistration(registration) },
    // Keep reload under the button's control, including updates from other windows.
    onNeedReload() { setActivatedUpdate(true) },
  })
  useEffect(() => {
    if (!swRegistration) return
    const check = () => {
      if (document.hidden) return
      if (swRegistration.waiting) setNeedRefresh(true)
      void swRegistration.update().catch(() => {})
    }
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', check)
    window.addEventListener('online', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('pageshow', check)
      window.removeEventListener('online', check)
    }
  }, [swRegistration, setNeedRefresh])
  async function checkAppUpdate() {
    if (checkUpdatePending.current || updatePending.current) return
    checkUpdatePending.current = true; setCheckingUpdate(true); setMessage('')
    try {
      const available = needRefresh || activatedUpdate || await checkForAppUpdate(swRegistration)
      if (available) { setNeedRefresh(true); setUpdateError(''); setMessage('新版本已就绪，请点击「更新应用」。') }
      else setMessage('当前已是最新版本。')
    } catch (error) { setMessage(errorText(error)) }
    finally { checkUpdatePending.current = false; setCheckingUpdate(false) }
  }
  async function updateApp() {
    if (mutationPending.current || updatePending.current || editor) return
    updatePending.current = true; setUpdating(true); setUpdateError('')
    try {
      await activateAppUpdate(swRegistration)
      window.location.reload()
    } catch (error) {
      setUpdateError(errorText(error))
      updatePending.current = false; setUpdating(false)
    }
  }
  const reload = useCallback(async () => {
    try { const value = await readLedger(); ledgerRef.current = value; setLedger(value); setLoadError('') }
    catch { setLoadError('无法读取本地资产。请重试；已有数据不会被清空。') }
  }, [])
  const mutate = useCallback(async (transform: (value: Ledger) => Ledger, revision = ledgerRef.current?.revision) => {
    if (revision === undefined || mutationPending.current || updatePending.current) throw new Error('正在处理其他操作，请稍后再试。')
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
      catch (error) { setRateError(`汇率更新失败：${errorText(error)} 有缓存时继续使用上次汇率，请稍后刷新。`); return }
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
  const totals = sumAssets(ledger?.assets ?? [])
  const total = convertedTotal(totals, currency, rate)
  const visibleAssets = sortAssetsByAmount((ledger?.assets ?? []).filter(asset => asset.source.toLocaleLowerCase().includes(search.toLocaleLowerCase())), assetSort, rate)
  const needsSortRate = assetSort !== 'default' && !validRate(rate) && new Set(visibleAssets.map(asset => asset.currency)).size > 1
  function assetRows(rows: Asset[]) {
    return rows.map(asset => {
      const previous = ledger?.snapshots.findLast(snapshot => snapshot.day < asset.updatedDay)
      const change = balanceChange(asset, previous)
      const previousAmount = change === null ? null : asset.amountMinor - change
      const changePercent = change !== null && previousAmount !== null && previousAmount !== 0 ? change / Math.abs(previousAmount) * 100 : null
      const percentLabel = changePercent === null ? '—' : `${changePercent > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(changePercent)}%`
      const balance = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(asset.amountMinor / (asset.currency === 'JPY' ? 1 : 100))
      return <button className="asset-row" key={asset.id} disabled={busy} onClick={() => edit(asset)} aria-label={`编辑 ${asset.source} ${asset.currency}`}>
        <span className={`currency-badge ${asset.currency.toLowerCase()}`}>{asset.currency === 'JPY' ? '日' : '元'}</span>
        <span className="asset-copy"><strong>{asset.source}</strong><small>{currencyName(asset.currency)}<time dateTime={asset.updatedDay} title={`更新于 ${asset.updatedDay}`}>{asset.updatedDay}</time></small></span>
        <span className="asset-money money">
          <span className={`money${asset.amountMinor < 0 ? ' money-down' : ''}`}>{asset.currency}{'\u00a0'}{balance}</span>
          {change === null || change === 0 ? <small title={change === null ? '暂无可比历史记录' : `较 ${previous!.day} 无变化`}>无变化</small> : <small className={`asset-change money${moneyChangeClass(change)}`} title={`较 ${previous!.day} ${formatMoneyChange(change, asset.currency)}；${changePercent === null ? '原余额为 0，无法计算变化百分比' : `变化 ${percentLabel}`}`}><span>{formatMoneyChange(change, asset.currency, { showCurrency: false })}</span><span>（{percentLabel}）</span></small>}
          {asset.currency !== currency && <small>≈ {money(convertedTotal({ JPY: 0, CNY: 0, [asset.currency]: asset.amountMinor }, currency, rate), currency)}</small>}
        </span>
        <Icon name="chevron-right" size={15} />
      </button>
    })
  }
  return <div className="app-shell">
    <main className="page">
      <header className="app-header">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}pwa-192x192-v1.8.0.png`} alt="" /><div className="brand-title"><strong>资金账本</strong><small className="brand-version">{__APP_VERSION__}</small></div></div>
        <div className="header-actions">
          {tab !== 'settings' && <button type="button" className="local-badge currency-toggle" aria-label={`当前币种：${currencyName(currency)}，点击切换为${currencyName(currency === 'JPY' ? 'CNY' : 'JPY')}`} title="切换登记与统计币种" onClick={() => setCurrency(value => value === 'JPY' ? 'CNY' : 'JPY')}>{currencyName(currency)}</button>}
        </div>
      </header>
      {(needRefresh || activatedUpdate) && !editor && <div className="notice app-update" aria-busy={updating}><span role="status">{updateError || (updating ? '正在应用新版本…' : saving ? '正在保存，请稍候…' : '新版本已就绪')}</span><button type="button" className="text-button" disabled={busy} onClick={() => void updateApp()}>{updating ? '正在更新…' : updateError ? '重试更新' : '更新应用'}</button></div>}
      {loadError ? <div className="card error-message" role="alert">{loadError}<button className="primary-button" onClick={() => void reload()}>重新读取</button></div> : !ledger ? <p className="empty-copy" role="status">正在打开资金账本…</p> : <>
        {tab === 'home' && <>
          <section className="balance-card" aria-label="当前总资产"><p className="eyebrow">我的总资产 · {currencyName(currency)}</p><TotalBalance total={total} snapshots={ledger.snapshots} currency={currency} today={today} /><div className="native-totals"><div><span>日元资产</span><b className="money">{money(totals.JPY, 'JPY')}</b></div><div><span>人民币资产</span><b className="money">{money(totals.CNY, 'CNY', 0)}</b></div></div></section>
          <RateHistory snapshots={ledger.snapshots} today={today} fetchedAt={rate?.fetchedAt} refreshing={rateBusy} disabled={busy} onRefresh={() => void refreshRate(true)} />
          {rateError && <p className="notice small" role="status">{rateError}</p>}
          {total === null && <p className="notice small">缺少汇率，暂不能合并两种币种；请联网后刷新。</p>}
        </>}
        {tab === 'assets' && <>
          <label className="search"><Icon name="search" size={18} /><input aria-label="搜索资产来源" placeholder="搜索资产来源" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="section-heading assets-heading"><h2>资产明细 <small>{ledger.assets.length} 项</small></h2><label className="asset-sort"><span>排序</span><select aria-label="资产排序" value={assetSort} onChange={event => { const value = assetSortPreference(event.target.value); setAssetSort(value); remember('asset-sort', value) }}><option value="default">默认</option><option value="desc">降序</option><option value="asc">升序</option></select></label></div>
          {needsSortRate && <p className="small muted asset-sort-note">缺少汇率，暂按币种分别排序。</p>}
          <section className="card assets-list">{visibleAssets.length ? assetRows(visibleAssets) : <div className="empty"><img src={emptyAssetsCat} alt="" /><h2>{search ? '没有找到这个来源' : '从第一份资产开始'}</h2><p>{search ? '试试其他关键词。' : '点击右下角猫咪，填写来源和当前余额。'}</p>{!search && <button className="text-button" onClick={() => edit()}>记一笔资产</button>}</div>}</section>
        </>}
        {tab === 'history' && <History ledger={ledger} currency={currency} today={today} onCorrect={correctHistorical} busy={busy} />}
        {tab === 'settings' && <>
          <div className="section-heading"><h1>设置</h1></div>
          <div className="settings-grid">
            <button type="button" className="card settings-action settings-update" disabled={checkingUpdate || updating} aria-label={checkingUpdate ? '正在检查更新' : '查看更新'} aria-busy={checkingUpdate} onClick={() => void checkAppUpdate()}><img src={settingsPrivacyCat} alt="" /><span>{checkingUpdate ? '检查中…' : '查看更新'}</span></button>
            <button type="button" className="card settings-action" aria-label={`当前为${dark ? '深色' : '浅色'}模式，点击切换为${dark ? '浅色' : '深色'}模式`} title={`切换为${dark ? '浅色' : '深色'}模式`} onClick={() => setDark(value => !value)}><Icon name={dark ? 'moon' : 'sun'} size={20} /><span>{dark ? '深色模式' : '浅色模式'}</span></button>
            <button type="button" className="card settings-action" onClick={() => downloadBackup(ledger)} disabled={busy}><Icon name="download" size={20} /><span>导出</span></button>
            <button type="button" className="card settings-action" disabled={busy} onClick={() => importInput.current?.click()}><Icon name="upload" size={20} /><span>导入</span></button>
          </div>
          <input ref={importInput} type="file" hidden accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void restore(file) }} />
        </>}
      </>}
    </main>
    {ledger && !loadError && tab !== 'settings' && <button className="floating-add" onClick={() => edit()} disabled={busy} aria-label="记一笔" title="记一笔资产" />}
    <nav className="tab-bar" aria-label="主导航">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); setSearch('') }}>{item.image ? <img src={item.image} alt="" /> : <Icon name="settings" size={28} />}<span>{item.label}</span></button>)}</nav>
    {editor && <AssetEditor asset={editor.asset} history={editor.history} currency={currency} onClose={() => setEditor(null)} onSave={save} onDelete={remove} />}
    {message && <div className="toast" role="status">{message}</div>}
  </div>
}
