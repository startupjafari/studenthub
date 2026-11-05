'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import { campusPresence, saveCampusPlan, type CampusPresence } from '../../../entities/campus'
import { toApiError } from '../../../shared/lib'
import { dropDraft, saveDraft } from '../lib/draft-db'
import type { EditorStore } from './store'

/** Пауза после правки до сохранения: серия правок уходит одним запросом. */
const SAVE_DELAY_MS = 1500
/** Черновик в IndexedDB пишется чаще — он дешёвый и страхует от закрытой вкладки. */
const DRAFT_DELAY_MS = 400
/** Пульс присутствия: ключ в Redis живёт 60 с. */
const PRESENCE_MS = 25_000
const RETRY_MS = [2_000, 5_000, 15_000, 30_000]

export interface AutosaveApi {
  /** Кто держит этаж, если не мы. */
  holder: CampusPresence['holder']
  /** Сохранить сейчас (Ctrl+S, уход со страницы). */
  flush: () => void
  /** Забрать правку у другого редактора. */
  takeOver: () => Promise<void>
  /** Ревизия сервера при конфликте — для «загрузить актуальную». */
  conflictRevision: number | null
}

/**
 * Автосохранение с оптимистичной конкуренцией (§20.3): `PUT` с `baseRevision`; чужая
 * правка — `409`, редактор переходит в «конфликт» и больше не пишет, пока человек не
 * выберет: загрузить актуальную или перезаписать своей. Нет сети — повтор с паузой, правки
 * копятся в IndexedDB. Пульс присутствия показывает «этаж правит …» и включает режим
 * только чтения у второго редактора.
 */
export function useAutosave(store: EditorStore, floorId: string): AutosaveApi {
  const [holder, setHolder] = useState<CampusPresence['holder']>(null)
  const [conflictRevision, setConflictRevision] = useState<number | null>(null)
  const saving = useRef(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retry = useRef(0)

  const save = useCallback(async (): Promise<void> => {
    const state = store.getState()
    if (state.saveState === 'readonly' || state.saveState === 'conflict') return
    if (saving.current) {
      pending.current = true
      return
    }
    if (state.saveState !== 'dirty' && state.saveState !== 'offline') return
    saving.current = true
    const doc = state.doc
    store.set({ saveState: 'saving' })
    reportLargePlan(floorId, doc)
    try {
      const { revision } = await saveCampusPlan(floorId, {
        baseRevision: state.revision,
        document: doc,
      })
      retry.current = 0
      // Пока шёл запрос, могли править дальше: тогда остаёмся «грязными».
      const changed = store.getState().doc !== doc
      store.set({ revision, saveState: changed ? 'dirty' : 'saved' })
      if (!changed) void dropDraft(floorId)
      else
        void saveDraft({
          floorId,
          baseRevision: revision,
          doc: store.getState().doc,
          savedAt: Date.now(),
        })
    } catch (e) {
      const err = toApiError(e)
      if (err.code === 'CONFLICT') {
        const current = Number(err.details?.[0]?.message)
        setConflictRevision(Number.isFinite(current) ? current : null)
        store.set({ saveState: 'conflict' })
      } else if (
        err.code === 'FORBIDDEN' ||
        err.code === 'WRONG_SCOPE' ||
        err.code === 'NOT_FOUND'
      ) {
        store.set({ saveState: 'readonly' })
      } else {
        store.set({ saveState: 'offline' })
        const delay = RETRY_MS[Math.min(retry.current, RETRY_MS.length - 1)]!
        retry.current += 1
        timer.current = setTimeout(() => void save(), delay)
      }
    } finally {
      saving.current = false
      if (pending.current) {
        pending.current = false
        if (store.getState().saveState === 'dirty') void save()
      }
    }
  }, [store, floorId])

  // Правка → черновик в IndexedDB и отложенное сохранение на сервер.
  useEffect(() => {
    let last = store.getState().doc
    let draftTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = store.subscribe(() => {
      const s = store.getState()
      if (s.doc === last) return
      last = s.doc
      if (s.saveState === 'readonly') return
      if (draftTimer) clearTimeout(draftTimer)
      draftTimer = setTimeout(() => {
        const cur = store.getState()
        void saveDraft({ floorId, baseRevision: cur.revision, doc: cur.doc, savedAt: Date.now() })
      }, DRAFT_DELAY_MS)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
    })
    return () => {
      unsubscribe()
      if (draftTimer) clearTimeout(draftTimer)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [store, floorId, save])

  // Сеть вернулась — сохранить сразу, не дожидаясь паузы повтора.
  useEffect(() => {
    const online = (): void => {
      if (store.getState().saveState === 'offline') void save()
    }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [store, save])

  // Несохранённое при уходе со страницы — предупреждение браузера.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent): void => {
      const st = store.getState().saveState
      if (st === 'dirty' || st === 'saving' || st === 'offline') e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [store])

  // Присутствие: один редактор на этаж, второй открывает его только для чтения.
  useEffect(() => {
    let alive = true
    const beat = async (force = false): Promise<void> => {
      try {
        const r = await campusPresence(floorId, force)
        if (!alive) return
        setHolder(r.mine ? null : r.holder)
        const st = store.getState().saveState
        if (!r.mine && st !== 'readonly') store.set({ saveState: 'readonly' })
        if (r.mine && st === 'readonly') store.set({ saveState: 'saved' })
      } catch {
        // Пульс — подсказка; без Redis правка всё равно защищена ревизией.
      }
    }
    void beat()
    const id = setInterval(() => void beat(), PRESENCE_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [store, floorId])

  const takeOver = useCallback(async () => {
    const r = await campusPresence(floorId, true)
    setHolder(r.mine ? null : r.holder)
    if (r.mine) store.set({ saveState: 'saved' })
  }, [store, floorId])

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    void save()
  }, [save])

  return { holder, flush, takeOver, conflictRevision }
}

/** Порог «план крупный» — половина лимита тела запроса (2 МиБ): пора смотреть, что раздуло. */
const LARGE_PLAN_BYTES = 1024 * 1024
const reported = new Set<string>()

/** Метрика размера документа (§22.34): раз за сессию на этаж, когда план перевалил за 1 МиБ. */
function reportLargePlan(floorId: string, doc: unknown): void {
  if (reported.has(floorId)) return
  const bytes = JSON.stringify(doc).length
  if (bytes < LARGE_PLAN_BYTES) return
  reported.add(floorId)
  Sentry.captureMessage('campus.large_floor_plan', {
    level: 'warning',
    tags: { area: 'campus-editor' },
    extra: { floorId, bytes },
  })
}
