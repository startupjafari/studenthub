'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TriangleAlert } from 'lucide-react'
import { CampusSceneController, type SceneInput, type ScenePalette } from '../model/scene'

export interface CampusSceneProps extends SceneInput {
  onPick?: (floorId: string, spaceId: string) => void
  /** Точка, к которой подвести камеру (метры сцены). */
  focusPoint?: { x: number; y: number; z: number } | null
  className?: string
  label: string
}

/**
 * Цвет CSS (в том числе oklch из темы) → `#rrggbb` для three: браузер сам переводит цвет,
 * если закрасить им пиксель и прочитать его обратно. Строку `fillStyle` three не разберёт.
 */
function toHex(ctx: CanvasRenderingContext2D | null, color: string, fallback: string): string {
  if (!ctx || !color) return fallback
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = fallback
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`
}

function readPalette(el: Element): ScenePalette {
  const css = getComputedStyle(el)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const bg = toHex(ctx, v('--background'), '#ffffff')
  const n = parseInt(bg.slice(1), 16)
  const dark = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128
  return {
    background: bg,
    wall: dark ? '#cbd5e1' : '#e5e7eb',
    slab: dark ? '#334155' : '#cbd5e1',
    primary: toHex(ctx, v('--primary'), '#2563eb'),
    ground: dark ? '#1e293b' : '#e2e8f0',
  }
}

/**
 * 3D-сцена кампуса. Модуль тянет three — подключать только через `CampusScene3D`
 * (ленивый импорт), чтобы ~140 КБ движка не попадали в общий бандл.
 */
export function CampusScene({ onPick, focusPoint, className, label, ...input }: CampusSceneProps) {
  const t = useTranslations('CampusEditor')
  const host = useRef<HTMLDivElement>(null)
  const ctrl = useRef<CampusSceneController | null>(null)
  const [lost, setLost] = useState(false)
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let c: CampusSceneController
    try {
      c = new CampusSceneController(el, readPalette(el))
    } catch {
      setUnsupported(true)
      return
    }
    ctrl.current = c
    c.onContextLost = setLost
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el)
    const mo = new MutationObserver(() => c.setPalette(readPalette(el)))
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })
    return () => {
      ro.disconnect()
      mo.disconnect()
      c.dispose()
      ctrl.current = null
    }
  }, [])

  useEffect(() => {
    if (ctrl.current) ctrl.current.onPick = onPick ?? null
  }, [onPick])

  const { floors, mode, focusFloorId, highlight, route, site } = input
  useEffect(() => {
    ctrl.current?.update({ floors, mode, focusFloorId, highlight, route, site })
  }, [floors, mode, focusFloorId, highlight, route, site])

  useEffect(() => {
    if (focusPoint) ctrl.current?.focusOn(focusPoint.x, focusPoint.y, focusPoint.z)
  }, [focusPoint])

  return (
    <div className={className ?? 'relative h-full w-full'}>
      <div
        ref={host}
        role="img"
        aria-label={label}
        className="absolute inset-0 rounded-[inherit] has-[canvas:focus-visible]:ring-4 has-[canvas:focus-visible]:ring-ring/30 has-[canvas:focus-visible]:ring-inset"
      />
      {(lost || unsupported) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 text-center text-sm">
          <p className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-warning" aria-hidden />
            {unsupported ? t('webglUnsupported') : t('webglLost')}
          </p>
        </div>
      )}
    </div>
  )
}
