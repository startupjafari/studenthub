'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Скачивание файлов внутри приложения — как в Telegram Web.
 *
 * Раньше файл открывался обычной ссылкой: браузер сам решал, показать его во вкладке или
 * скачать, прогресса в приложении не было, отменить было нечем, а на телефоне PDF
 * открывался поверх приложения, и назад приходилось выбираться жестом. Теперь нажатие
 * скачивает файл в память вкладки с прогрессом на значке и отменой; когда он готов, второе
 * нажатие сохраняет: на компьютере — обычным скачиванием, на телефоне — системным листом
 * «Поделиться», где есть «Сохранить в Файлы».
 *
 * Состояние общее для всего приложения и живёт вне React: один и тот же файл виден и в
 * ленте, и во вкладке «Файлы», и в просмотрщике, и начатое в одном месте скачивание
 * должно быть видно в другом. Ключ — id файла (или путь объекта без подписи: подписанная
 * ссылка меняется при каждом перевыпуске, а сам файл тот же).
 *
 * Хранилище отдаёт файлы на `fetch` с нашего сайта (CORS) — на этом же стоит прямая
 * загрузка и копирование снимка в буфер. `Content-Length` читается без особых заголовков:
 * он в списке безопасных, и по нему считается процент.
 */

export type DownloadState =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number | null }
  | { status: 'ready'; size: number }
  | { status: 'error' }

type Entry =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number | null; controller: AbortController }
  | { status: 'ready'; size: number; blob: Blob; name: string }
  | { status: 'error' }

/** Сколько скачанного держим в памяти вкладки, байты. Больше — выбрасываем самое старое. */
const CACHE_LIMIT = 400 * 1024 * 1024
/** Как часто обновлять прогресс: чаще перерисовка ничего не добавляет глазу. */
const PROGRESS_EVERY_MS = 120

const IDLE: DownloadState = { status: 'idle' }
const entries = new Map<string, Entry>()
const snapshots = new Map<string, DownloadState>()
const listeners = new Map<string, Set<() => void>>()

function set(key: string, entry: Entry): void {
  entries.set(key, entry)
  // Снимок — отдельный объект без blob и контроллера: его отдаёт useSyncExternalStore, и он
  // обязан быть одним и тем же объектом, пока состояние не изменилось.
  snapshots.set(key, toState(entry))
  listeners.get(key)?.forEach((notify) => notify())
}

function toState(entry: Entry): DownloadState {
  switch (entry.status) {
    case 'loading':
      return { status: 'loading', loaded: entry.loaded, total: entry.total }
    case 'ready':
      return { status: 'ready', size: entry.size }
    default:
      return entry
  }
}

function subscribe(key: string, notify: () => void): () => void {
  let bucket = listeners.get(key)
  if (!bucket) {
    bucket = new Set()
    listeners.set(key, bucket)
  }
  bucket.add(notify)
  return () => {
    bucket?.delete(notify)
  }
}

/** Самое старое готовое — вон, пока скачанное не влезет в потолок памяти. */
function trimCache(): void {
  let total = 0
  for (const entry of entries.values()) if (entry.status === 'ready') total += entry.size
  for (const [key, entry] of entries) {
    if (total <= CACHE_LIMIT) break
    if (entry.status !== 'ready') continue
    total -= entry.size
    set(key, { status: 'idle' })
  }
}

export interface DownloadSource {
  /** Готовая ссылка или способ её получить (подписанные ссылки выдаются по запросу). */
  url: string | (() => Promise<string | undefined>)
  name: string
  mime?: string | null
}

async function start(key: string, source: DownloadSource): Promise<void> {
  const current = entries.get(key)
  if (current?.status === 'loading' || current?.status === 'ready') return
  const controller = new AbortController()
  set(key, { status: 'loading', loaded: 0, total: null, controller })
  try {
    const url = typeof source.url === 'string' ? source.url : await source.url()
    if (!url) throw new Error('no url')
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || null
    const reader = res.body.getReader()
    const chunks: BlobPart[] = []
    let loaded = 0
    let shownAt = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      const now = performance.now()
      if (now - shownAt > PROGRESS_EVERY_MS) {
        shownAt = now
        set(key, { status: 'loading', loaded, total, controller })
      }
    }
    const type = source.mime || res.headers.get('content-type') || 'application/octet-stream'
    const blob = new Blob(chunks, { type })
    // Ключ перезаписываем только если это всё ещё наше скачивание, а не отменённое и
    // начатое заново за время последнего чтения.
    if (entries.get(key)?.status !== 'loading') return
    set(key, { status: 'ready', size: blob.size, blob, name: source.name })
    trimCache()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      set(key, { status: 'idle' })
      return
    }
    set(key, { status: 'error' })
  }
}

function cancel(key: string): void {
  const entry = entries.get(key)
  if (entry?.status === 'loading') entry.controller.abort()
}

/**
 * Сохранить скачанное на устройство.
 *
 * Телефон — системным листом «Поделиться» с самим файлом: только так его можно положить в
 * «Файлы» на iOS, а на Android — в загрузки или в нужное приложение. Компьютер — обычным
 * скачиванием по ссылке на blob. Лист закрыли без выбора — это не ошибка; лист не
 * принял файл (большой, неподдерживаемый тип) — сохраняем скачиванием.
 */
export async function saveBlob(blob: Blob, name: string): Promise<void> {
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false
  if (touch && typeof navigator.canShare === 'function') {
    const file = new File([blob], name, { type: blob.type })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name })
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      }
    }
  }
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Ссылку живой держим минуту: браузер начинает запись не мгновенно, и ранний revoke
  // обрывал скачивание в Safari.
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

function save(key: string): void {
  const entry = entries.get(key)
  if (entry?.status === 'ready') void saveBlob(entry.blob, entry.name)
}

/** Ключ файла по подписанной ссылке: путь объекта без подписи — он не меняется. */
export function downloadKeyOf(url: string): string {
  return url.split('?')[0] ?? url
}

export interface FileDownload {
  state: DownloadState
  /** Главное действие: скачать → (во время скачивания) отменить → (готово) сохранить. */
  toggle: () => void
  start: () => void
  cancel: () => void
  save: () => void
  /** Доля скачанного 0…1; null — размер неизвестен или скачивание не идёт. */
  progress: number | null
}

export function useFileDownload(key: string, source: DownloadSource): FileDownload {
  const state = useSyncExternalStore(
    useCallback((notify) => subscribe(key, notify), [key]),
    () => snapshots.get(key) ?? IDLE,
    () => IDLE,
  )

  // source пересоздаётся каждым рендером — берём его в момент нажатия, а не в зависимости.
  const startNow = (): void => void start(key, source)
  const toggle = (): void => {
    if (state.status === 'loading') cancel(key)
    else if (state.status === 'ready') save(key)
    else startNow()
  }

  const progress =
    state.status === 'loading' && state.total ? Math.min(1, state.loaded / state.total) : null

  return {
    state,
    toggle,
    start: startNow,
    cancel: () => cancel(key),
    save: () => save(key),
    progress,
  }
}
