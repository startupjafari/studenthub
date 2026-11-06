import type { FloorPlanDoc } from '@studenthub/campus-core'

/**
 * Локальный черновик этажа в IndexedDB (§20.4): правка не теряется, если сеть пропала или
 * вкладку закрыли до автосохранения. Ключ — этаж; при открытии редактор сравнивает ревизию
 * черновика с серверной и предлагает восстановить. Ошибки хранилища проглатываются: это
 * страховка, а не основной путь.
 */
export interface FloorDraft {
  floorId: string
  /** Ревизия сервера, от которой шла правка. */
  baseRevision: number
  doc: FloorPlanDoc
  savedAt: number
}

const DB_NAME = 'campus-editor'
const STORE = 'drafts'
/** Неделя: старше — почти наверняка забытый черновик, сервер давно ушёл вперёд. */
const TTL_MS = 7 * 24 * 3600 * 1000

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'floorId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    const result = await promisify(fn(db.transaction(STORE, mode).objectStore(STORE)))
    db.close()
    return result
  } catch {
    return null
  }
}

export async function loadDraft(floorId: string): Promise<FloorDraft | null> {
  const draft = await withStore<FloorDraft | undefined>('readonly', (s) => s.get(floorId))
  if (!draft) return null
  if (Date.now() - draft.savedAt > TTL_MS) {
    await dropDraft(floorId)
    return null
  }
  return draft
}

export async function saveDraft(draft: FloorDraft): Promise<void> {
  await withStore('readwrite', (s) => s.put(draft))
}

export async function dropDraft(floorId: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(floorId))
}
