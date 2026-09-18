export function checkForAppUpdate(registration: ServiceWorkerRegistration | undefined): Promise<boolean> {
  if (!registration) return Promise.reject(new Error('更新服务尚未就绪，请稍后重试。'))
  if (registration.waiting) return Promise.resolve(true)

  return new Promise((resolve, reject) => {
    const initialActive = registration.active
    let worker: ServiceWorker | null = null
    let checked = false
    let finished = false
    const finish = (available: boolean, error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      registration.removeEventListener('updatefound', inspect)
      worker?.removeEventListener('statechange', inspect)
      document.removeEventListener('visibilitychange', inspect)
      if (error) reject(error)
      else resolve(available)
    }
    const inspect = () => {
      if (finished) return
      if (registration.installing && registration.installing !== worker) {
        worker?.removeEventListener('statechange', inspect)
        worker = registration.installing
        worker.addEventListener('statechange', inspect)
      }
      if (registration.waiting || worker?.state === 'installed' || worker?.state === 'activated'
        || (registration.active && registration.active !== initialActive)) {
        finish(true)
      } else if (worker?.state === 'redundant') {
        finish(false, new Error('新版下载失败，请检查网络后重试。'))
      } else if (checked && !worker) {
        finish(false)
      }
    }
    const timeout = window.setTimeout(() => {
      inspect()
      if (!finished) finish(false, new Error('检查更新超时，请稍后重试。'))
    }, 30000)
    registration.addEventListener('updatefound', inspect)
    document.addEventListener('visibilitychange', inspect)
    inspect()
    // update() can finish before installation; keep watching until files are ready.
    void registration.update().then(() => { checked = true; inspect() }).catch(() => {
      finish(false, new Error('检查更新失败，请确认网络连接后重试。'))
    })
  })
}

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
