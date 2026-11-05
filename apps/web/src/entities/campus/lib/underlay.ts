'use client'

import { useSyncExternalStore } from 'react'

/**
 * Подложка редактора — снимок со спутника или фото поэтажного плана под чертежом: по ней
 * обводят корпус и стены вместо рисования «на глаз». Хранится только в этом браузере
 * (IndexedDB): это подсказка тому, кто рисует, — на карту и другим редакторам она не уходит,
 * и сервер о ней не знает.
 *
 * Положение — в мм плана: левый верхний угол картинки и масштаб «мм на пиксель». Масштаб
 * задаётся по двум точкам с известным расстоянием между ними.
 */
export interface UnderlayPlacement {
  /** Левый верхний угол картинки в координатах плана (ось Y — вверх). */
  x: number
  y: number
  mmPerPx: number
  opacity: number
  visible: boolean
}

export type UnderlayMode = 'idle' | 'calibrate' | 'move'

interface Pt {
  x: number
  y: number
}

export interface UnderlayState {
  placement: UnderlayPlacement | null
  image: HTMLImageElement | null
  mode: UnderlayMode
  /** Точки калибровки масштаба на плане: ноль, одна или две. */
  calib: Pt[]
}

export interface PlanRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const DB_NAME = 'campus-underlay'
const STORE = 'underlays'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Хранилище недоступно (приватное окно, запрет) — подложка просто живёт до перезагрузки. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    const result = await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}

function decode(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image'))
    }
    img.src = url
  })
}

export class UnderlayStore {
  private state: UnderlayState = { placement: null, image: null, mode: 'idle', calib: [] }
  private readonly listeners = new Set<() => void>()
  private dragFrom: Pt | null = null

  /** `key` — что подкладываем: территория кампуса или этаж (`site:<id>`, `floor:<id>`). */
  constructor(readonly key: string) {}

  getState = (): UnderlayState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<UnderlayState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  async load(): Promise<void> {
    const [blob, placement] = await Promise.all([
      withStore<Blob | undefined>('readonly', (s) => s.get(`${this.key}:image`)),
      withStore<UnderlayPlacement | undefined>('readonly', (s) => s.get(`${this.key}:placement`)),
    ])
    if (!blob || !placement) return
    try {
      this.set({ image: await decode(blob), placement })
    } catch {
      // Битая запись — как будто подложки нет.
    }
  }

  /** Новая картинка: вписывается в видимую часть плана, масштаб потом уточняют по точкам. */
  async setFile(file: Blob, view: PlanRect): Promise<void> {
    const image = await decode(file)
    const w = Math.max(1, image.naturalWidth)
    const h = Math.max(1, image.naturalHeight)
    const mmPerPx = Math.min(((view.x1 - view.x0) * 0.9) / w, ((view.y1 - view.y0) * 0.9) / h)
    const placement: UnderlayPlacement = {
      x: (view.x0 + view.x1) / 2 - (w * mmPerPx) / 2,
      y: (view.y0 + view.y1) / 2 + (h * mmPerPx) / 2,
      mmPerPx,
      opacity: 0.5,
      visible: true,
    }
    this.revoke()
    this.set({ image, placement, mode: 'calibrate', calib: [] })
    await withStore('readwrite', (s) => s.put(file, `${this.key}:image`))
    await this.persist()
  }

  update(patch: Partial<UnderlayPlacement>): void {
    if (!this.state.placement) return
    this.set({ placement: { ...this.state.placement, ...patch } })
    void this.persist()
  }

  setMode(mode: UnderlayMode): void {
    this.dragFrom = null
    this.set({ mode, calib: [] })
  }

  /**
   * Масштаб по двум точкам: расстояние между ними на плане становится `realMm`. Пиксель
   * картинки под первой точкой остаётся на месте — подложка не уезжает из-под курсора.
   */
  calibrate(realMm: number): void {
    const { placement, calib } = this.state
    const [a, b] = calib
    if (!placement || !a || !b || realMm <= 0) return
    const measured = Math.hypot(b.x - a.x, b.y - a.y)
    if (measured <= 0) return
    const k = realMm / measured
    const u = (a.x - placement.x) / placement.mmPerPx
    const v = (placement.y - a.y) / placement.mmPerPx
    const mmPerPx = placement.mmPerPx * k
    this.set({
      placement: { ...placement, mmPerPx, x: a.x - u * mmPerPx, y: a.y + v * mmPerPx },
      mode: 'idle',
      calib: [],
    })
    void this.persist()
  }

  async remove(): Promise<void> {
    this.revoke()
    this.set({ image: null, placement: null, mode: 'idle', calib: [] })
    await withStore('readwrite', (s) => s.delete(`${this.key}:image`))
    await withStore('readwrite', (s) => s.delete(`${this.key}:placement`))
  }

  /**
   * Указатель холста в режимах подложки: калибровка ставит точки, сдвиг двигает картинку.
   * true — событие съедено, инструмент редактора его не получает.
   */
  pointer(type: 'down' | 'move' | 'up', p: Pt): boolean {
    const { mode, placement, calib } = this.state
    if (!placement || mode === 'idle') return false
    if (mode === 'calibrate') {
      if (type === 'down') this.set({ calib: calib.length >= 2 ? [p] : [...calib, p] })
      return true
    }
    if (type === 'down') this.dragFrom = p
    else if (this.dragFrom) {
      const dx = p.x - this.dragFrom.x
      const dy = p.y - this.dragFrom.y
      this.dragFrom = type === 'up' ? null : p
      this.set({ placement: { ...placement, x: placement.x + dx, y: placement.y + dy } })
      if (type === 'up') void this.persist()
    }
    return true
  }

  private async persist(): Promise<void> {
    const placement = this.state.placement
    if (placement) await withStore('readwrite', (s) => s.put(placement, `${this.key}:placement`))
  }

  private revoke(): void {
    const src = this.state.image?.src
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
  }

  dispose(): void {
    this.revoke()
    this.listeners.clear()
  }
}

export function useUnderlay<T>(store: UnderlayStore, selector: (s: UnderlayState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}

/**
 * Подложка на холсте — сразу после заливки фона, под всем чертежом. Точки калибровки и
 * линия между ними — поверх картинки, цветом выделения.
 */
export function drawUnderlay(
  g: CanvasRenderingContext2D,
  s: UnderlayState,
  view: { scale: number; ox: number; oy: number },
  accent: string,
): void {
  const { placement, image } = s
  if (!placement || !image) return
  const sx = (x: number): number => view.ox + x * view.scale
  const sy = (y: number): number => view.oy - y * view.scale
  if (placement.visible) {
    g.save()
    g.globalAlpha = placement.opacity
    g.imageSmoothingQuality = 'high'
    g.drawImage(
      image,
      sx(placement.x),
      sy(placement.y),
      image.naturalWidth * placement.mmPerPx * view.scale,
      image.naturalHeight * placement.mmPerPx * view.scale,
    )
    g.restore()
  }
  if (s.mode === 'calibrate' && s.calib.length > 0) {
    g.save()
    g.strokeStyle = accent
    g.fillStyle = accent
    g.lineWidth = 2
    g.setLineDash([6, 4])
    if (s.calib.length === 2) {
      g.beginPath()
      g.moveTo(sx(s.calib[0]!.x), sy(s.calib[0]!.y))
      g.lineTo(sx(s.calib[1]!.x), sy(s.calib[1]!.y))
      g.stroke()
    }
    g.setLineDash([])
    for (const p of s.calib) {
      g.beginPath()
      g.arc(sx(p.x), sy(p.y), 5, 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
  }
}
