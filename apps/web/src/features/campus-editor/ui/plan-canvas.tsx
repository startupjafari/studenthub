'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { hitTest } from '../lib/hit'
import { drawPlan, readPalette, type Palette } from '../lib/draw'
import type { EditorStore, Selection } from '../model/store'
import type { PointerInput, ToolController } from '../model/tools'

/** Радиус попадания: мышью — 8 px, пальцем и пером — 22 px (ручка 44 px, §12.11). */
const HIT_PX = { mouse: 8, touch: 22, pen: 14 } as const
/** Перо видели недавно — касания ладони не рисуют, а только двигают план. */
const PALM_MS = 1500
const LOUPE_PX = 120
const LOUPE_ZOOM = 2.5

interface Props {
  store: EditorStore
  tools: ToolController
  problemsShown: boolean
}

/**
 * Холст плана: Canvas 2D с учётом плотности пикселей, перерисовка по подписке через
 * requestAnimationFrame. Жесты: колесо — масштаб к курсору (Shift — сдвиг), средняя кнопка,
 * пробел или инструмент «Рука» — панорама, два пальца — щипок. На планшете перо рисует, а
 * касания ладони рядом с ним только двигают план; под пальцем и пером — лупа с точкой
 * привязки, иначе её закрывает рука (§12.11).
 */
export function PlanCanvas({ store, tools, problemsShown }: Props) {
  const t = useTranslations('CampusEditor')
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const problemsRef = useRef(problemsShown)
  problemsRef.current = problemsShown
  const kindLabelRef = useRef((kind: string) => t(`kind_${kind}`))
  kindLabelRef.current = (kind: string) => t(`kind_${kind}`)

  // Метки проблем включаются вкладкой «Проверка» — холст перерисовывается по подписке.
  useEffect(() => store.set({}), [store, problemsShown])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const g = canvas.getContext('2d')
    if (!g) return

    let width = 0
    let height = 0
    let frame = 0
    let palette: Palette = readPalette(canvas)
    let hover: Selection | undefined
    let loupe: { x: number; y: number } | null = null
    let fitted = false

    const draw = (): void => {
      frame = 0
      const dpr = window.devicePixelRatio || 1
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const state = store.getState()
      const opts = {
        hoverSelection: hover,
        showNodes: state.tool === 'select' || state.tool === 'wall',
        problemsShown: problemsRef.current,
        kindLabel: kindLabelRef.current,
      }
      drawPlan(g, state, palette, width, height, opts)
      if (loupe) {
        // Лупа над точкой касания: тот же план крупнее, вырезанный кругом.
        const r = LOUPE_PX / 2
        const cx = Math.min(width - r - 8, Math.max(r + 8, loupe.x))
        const cy = Math.max(r + 8, loupe.y - LOUPE_PX)
        const v = state.view
        const scale = v.scale * LOUPE_ZOOM
        const zoomed = {
          ...state,
          view: {
            scale,
            ox: cx - (loupe.x - v.ox) * LOUPE_ZOOM,
            oy: cy - (loupe.y - v.oy) * LOUPE_ZOOM,
          },
        }
        g.save()
        g.beginPath()
        g.arc(cx, cy, r, 0, Math.PI * 2)
        g.clip()
        drawPlan(g, zoomed, palette, width, height, { ...opts, hoverSelection: undefined })
        g.restore()
        g.beginPath()
        g.arc(cx, cy, r, 0, Math.PI * 2)
        g.strokeStyle = palette.primary
        g.lineWidth = 2
        g.stroke()
      }
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(draw)
    }

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      if (!fitted && width > 0) {
        fitted = true
        store.fit(width, height)
      }
      schedule()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()
    const unsubscribe = store.subscribe(schedule)

    // Тема сменилась — цвета холста перечитываются.
    const themeObserver = new MutationObserver(() => {
      palette = readPalette(canvas)
      schedule()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })

    // ── Указатель ────────────────────────────────────────────────────────────────────
    const pointers = new Map<number, { x: number; y: number; type: string }>()
    let pinch: { dist: number; cx: number; cy: number } | null = null
    let panning: { x: number; y: number } | null = null
    let drawingPointer: number | null = null
    let penAt = 0
    let spaceHeld = false

    const local = (e: PointerEvent | MouseEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const input = (e: PointerEvent | MouseEvent, type: string): PointerInput => {
      const p = local(e)
      const px = HIT_PX[type as keyof typeof HIT_PX] ?? HIT_PX.mouse
      return {
        plan: store.toPlan(p.x, p.y),
        shift: e.shiftKey,
        alt: e.altKey,
        radiusMm: px / store.getState().view.scale,
      }
    }

    const onDown = (e: PointerEvent): void => {
      const p = local(e)
      if (e.pointerType === 'pen') penAt = Date.now()
      pointers.set(e.pointerId, { ...p, type: e.pointerType })
      canvas.setPointerCapture(e.pointerId)
      const palm = e.pointerType === 'touch' && Date.now() - penAt < PALM_MS
      if (pointers.size === 2) {
        // Второй палец: незаконченный жест инструмента отменяется, начинается щипок.
        if (drawingPointer !== null) tools.cancel()
        drawingPointer = null
        loupe = null
        const [a, b] = [...pointers.values()]
        pinch = {
          dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          cx: (a!.x + b!.x) / 2,
          cy: (a!.y + b!.y) / 2,
        }
        return
      }
      const tool = store.getState().tool
      if (e.button === 1 || spaceHeld || tool === 'pan' || palm) {
        panning = p
        canvas.style.cursor = 'grabbing'
        return
      }
      if (e.button !== 0) return
      drawingPointer = e.pointerId
      if (e.pointerType !== 'mouse' && tool !== 'select') loupe = p
      tools.down(input(e, e.pointerType))
      schedule()
    }

    const onMove = (e: PointerEvent): void => {
      const p = local(e)
      const prev = pointers.get(e.pointerId)
      if (prev) pointers.set(e.pointerId, { ...p, type: prev.type })
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const cx = (a!.x + b!.x) / 2
        const cy = (a!.y + b!.y) / 2
        store.pan(cx - pinch.cx, cy - pinch.cy)
        if (pinch.dist > 0) store.zoomAt(cx, cy, dist / pinch.dist)
        pinch = { dist, cx, cy }
        return
      }
      if (panning) {
        store.pan(p.x - panning.x, p.y - panning.y)
        panning = p
        return
      }
      if (drawingPointer !== null && drawingPointer !== e.pointerId) return
      if (loupe) loupe = p
      tools.move(input(e, e.pointerType))
      const s = store.getState()
      if (s.tool === 'select' && drawingPointer === null && e.pointerType === 'mouse') {
        const i = input(e, 'mouse')
        const next = hitTest(s.doc, s.faces, s.faceSpace, i.plan, i.radiusMm)
        if (JSON.stringify(next) !== JSON.stringify(hover)) {
          hover = next.kind === 'none' ? undefined : next
          canvas.style.cursor = next.kind === 'node' || next.kind === 'opening' ? 'move' : 'default'
        }
      }
      schedule()
    }

    const onUp = (e: PointerEvent): void => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (panning) {
        panning = null
        canvas.style.cursor = ''
        return
      }
      if (drawingPointer === e.pointerId) {
        drawingPointer = null
        loupe = null
        tools.up(input(e, e.pointerType))
      }
      schedule()
    }

    const onCancel = (e: PointerEvent): void => {
      pointers.delete(e.pointerId)
      pinch = null
      panning = null
      if (drawingPointer === e.pointerId) {
        drawingPointer = null
        loupe = null
        tools.cancel()
      }
    }

    const onDouble = (e: MouseEvent): void => {
      tools.doubleClick({ ...input(e, 'mouse'), double: true })
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const p = local(e)
      if (e.shiftKey && !e.ctrlKey) {
        store.pan(-e.deltaY, 0)
        return
      }
      // Щипок тачпада приходит колесом с Ctrl и мелкими шагами — множитель плавный.
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      store.zoomAt(p.x, p.y, k)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return
      spaceHeld = e.type === 'keydown'
      canvas.style.cursor = spaceHeld ? 'grab' : ''
      if (spaceHeld) e.preventDefault()
    }

    const onLeave = (): void => {
      hover = undefined
      if (store.getState().preview.cursor || store.getState().preview.opening) {
        const { cursor: _c, opening: _o, ...rest } = store.getState().preview
        store.set({ preview: rest })
      }
      schedule()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('dblclick', onDouble)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)

    return () => {
      ro.disconnect()
      themeObserver.disconnect()
      unsubscribe()
      if (frame) cancelAnimationFrame(frame)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('dblclick', onDouble)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [store, tools])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('canvasLabel')}
        className="block touch-none select-none"
      />
    </div>
  )
}
