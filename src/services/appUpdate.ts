// A refresh prompt can outlive the waiting worker, especially after resuming
// an installed app. Inspect its current state instead of only sending a message.
export function activateAppUpdate(registration: ServiceWorkerRegistration | undefined): Promise<void> {
  const worker = registration?.waiting ?? registration?.installing ?? registration?.active
  if (!worker) return Promise.reject(new Error('更新尚未就绪，请稍后重试。'))

  return new Promise((resolve, reject) => {
    let finished = false
    let requested = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      worker.removeEventListener('statechange', check)
      navigator.serviceWorker.removeEventListener('controllerchange', check)
      document.removeEventListener('visibilitychange', check)
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (finished) return
      if (worker.state === 'activated') {
        // Also handles a stale prompt when another window already activated it.
        finish()
      } else if (worker.state === 'redundant') {
        finish(new Error('更新已被替换，请重试。'))
      } else if (worker.state === 'installed' && !requested) {
        requested = true
        try { worker.postMessage({ type: 'SKIP_WAITING' }) }
        catch { finish(new Error('无法启动更新，请重试。')) }
      }
    }
    const timeout = window.setTimeout(() => {
      check()
      if (!finished) finish(new Error('更新超时，请重试；仍无响应时，可从多任务界面关闭应用后重新打开。'))
    }, 15000)
    worker.addEventListener('statechange', check)
    navigator.serviceWorker.addEventListener('controllerchange', check)
    document.addEventListener('visibilitychange', check)
    check()
  })
}
