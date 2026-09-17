import { openDB } from 'idb'
import { EMPTY_LEDGER } from '../domain/ledger.ts'
import type { Ledger } from '../domain/ledger.ts'

export const DB_NAME = 'my-assets-db'
const STORE = 'state'
let connection: ReturnType<typeof openDB> | undefined
function database() {
  if (!connection) connection = openDB(DB_NAME, 1, {
    upgrade(db) { db.createObjectStore(STORE) },
    blocking() { void connection?.then(db => db.close()); connection = undefined },
    terminated() { connection = undefined },
  }).catch(error => { connection = undefined; throw error })
  return connection
}
export async function readLedger(): Promise<Ledger> {
  return (await (await database()).get(STORE, 'ledger')) ?? structuredClone(EMPTY_LEDGER)
}
export async function changeLedger(expectedRevision: number, transform: (ledger: Ledger) => Ledger): Promise<Ledger> {
  const db = await database()
  const tx = db.transaction(STORE, 'readwrite')
  try {
    const current: Ledger = (await tx.store.get('ledger')) ?? structuredClone(EMPTY_LEDGER)
    if (current.revision !== expectedRevision) throw new Error('数据已在另一个窗口更新，请重新打开记录后保存。')
    const next = transform(current)
    next.revision = current.revision + 1
    await tx.store.put(next, 'ledger')
    await tx.done
    return next
  } catch (error) {
    try { tx.abort() } catch { /* transaction may already have aborted */ }
    await tx.done.catch(() => {})
    throw error
  }
}
