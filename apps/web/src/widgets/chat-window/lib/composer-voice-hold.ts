'use client'

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { VoiceRecorderController } from '../../../entities/chat'
import {
  createSpring,
  hapticTick,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
  type SpringHandle,
} from '../../../shared/lib'

/** Сколько провести вверх, чтобы зафиксировать запись (руки свободны, отправка кнопкой). */
const LOCK_DISTANCE = 72
/** Сколько провести влево, чтобы отменить запись. */
const CANCEL_DISTANCE = 120
/** Короче — это касание, а не удержание: запись отменяется, человеку подсказываем жест. */
const TAP_MS = 250

type Point = { position: number; time: number }

export interface ComposerVoiceHold {
  /** Палец держит кнопку записи: запись идёт, но ещё не зафиксирована. */
  holding: boolean
  /** Кнопка, которая едет за пальцем. */
  buttonRef: RefObject<HTMLButtonElement | null>
  /** Значок замка над кнопкой: поднимается вместе с пальцем. */
  lockRef: RefObject<HTMLDivElement | null>
  /** Подсказка «влево — отмена»: уезжает вслед за пальцем и гаснет. */
  hintRef: RefObject<HTMLDivElement | null>
  /** Обработчик нажатия на кнопку записи — только палец и перо; мышь записывает по клику. */
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
}

/**
 * Запись голосового удержанием, как в Telegram на телефоне: держишь — пишется, отпустил —
 * ушло; вверх до замка — запись фиксируется и пальцы свободны; влево — отмена.
 *
 * Слушатели движения висят на окне, а не на кнопке: пока идёт запись, строка ввода
 * перестраивается, и привязанная к элементу цель жеста могла бы потеряться. Положение
 * пишется в `transform` напрямую — перерисовывать всё поле ввода на каждый кадр незачем.
 *
 * Решение на отпускании принимается по проекции (точка, где палец остановился бы сам), а не
 * по сырому смещению: короткий резкий взмах вверх фиксирует запись, вялое движение — нет.
 */
export function useComposerVoiceHold(
  voice: VoiceRecorderController,
  { onTapHint }: { onTapHint: () => void },
): ComposerVoiceHold {
  const [holding, setHolding] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const lockRef = useRef<HTMLDivElement | null>(null)
  const hintRef = useRef<HTMLDivElement | null>(null)
  // Палец отпустили раньше, чем браузер выдал микрофон: запись, которая начнётся следом,
  // никому не нужна — гасим её сразу после старта.
  const cancelOnStart = useRef(false)
  const springs = useRef<{ x: SpringHandle; y: SpringHandle } | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const tapHintRef = useRef(onTapHint)
  tapHintRef.current = onTapHint

  useEffect(() => {
    if (voice.recording && cancelOnStart.current) {
      cancelOnStart.current = false
      voice.cancel()
    }
  }, [voice.recording, voice])

  useEffect(
    () => () => {
      detach.current?.()
      springs.current?.x.stop()
      springs.current?.y.stop()
    },
    [],
  )

  function paint(dx: number, dy: number): void {
    const button = buttonRef.current
    if (button) button.style.transform = dx || dy ? `translate3d(${dx}px, ${dy}px, 0)` : ''
    const lock = lockRef.current
    if (lock) {
      const progress = Math.min(1, -dy / LOCK_DISTANCE)
      lock.style.transform = `translate3d(0, ${dy * 0.35}px, 0)`
      lock.style.opacity = String(0.6 + 0.4 * progress)
    }
    const hint = hintRef.current
    if (hint) {
      hint.style.transform = dx ? `translate3d(${dx * 0.5}px, 0, 0)` : ''
      hint.style.opacity = String(Math.max(0, 1 - -dx / CANCEL_DISTANCE))
    }
  }

  /** Вернуть кнопку на место пружиной — от того места и с той скоростью, где её отпустили. */
  function settle(fromX: number, fromY: number, vx: number, vy: number): void {
    if (prefersReducedMotion()) {
      paint(0, 0)
      return
    }
    springs.current?.x.stop()
    springs.current?.y.stop()
    const state = { x: fromX, y: fromY }
    const x = createSpring({
      from: fromX,
      damping: 1,
      response: 0.4,
      onChange: (v) => {
        state.x = v
        paint(state.x, state.y)
      },
    })
    const y = createSpring({
      from: fromY,
      damping: 1,
      response: 0.4,
      onChange: (v) => {
        state.y = v
        paint(state.x, state.y)
      },
    })
    springs.current = { x, y }
    x.to(0, vx)
    y.to(0, vy)
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>): void {
    if (e.pointerType === 'mouse' || e.button !== 0 || voiceRef.current.recording) return
    // Без этого браузер начнёт выделение текста или откроет меню долгого нажатия.
    e.preventDefault()
    detach.current?.()
    springs.current?.x.stop()
    springs.current?.y.stop()
    const pointerId = e.pointerId
    const x0 = e.clientX
    const y0 = e.clientY
    const t0 = performance.now()
    const histX: Point[] = []
    const histY: Point[] = []
    let dx = 0
    let dy = 0
    let done = false

    cancelOnStart.current = false
    setHolding(true)
    void voiceRef.current.start()

    const finish = (outcome: 'send' | 'lock' | 'cancel' | 'tap'): void => {
      if (done) return
      done = true
      detach.current?.()
      setHolding(false)
      const v = voiceRef.current
      if (outcome === 'lock') {
        hapticTick()
        if (!v.recording) cancelOnStart.current = false
      } else if (outcome === 'send' && v.recording) {
        v.finish()
      } else if (v.recording) {
        v.cancel()
      } else {
        // Микрофон ещё не выдан (окно разрешения): запись, начавшаяся позже, не нужна.
        cancelOnStart.current = true
      }
      if (outcome === 'cancel') hapticTick()
      if (outcome === 'tap') tapHintRef.current()
      settle(dx, dy, velocityFrom(histX), velocityFrom(histY))
    }

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      const now = performance.now()
      const rawX = Math.min(0, ev.clientX - x0)
      const rawY = Math.min(0, ev.clientY - y0)
      histX.push({ position: rawX, time: now })
      histY.push({ position: rawY, time: now })
      if (histX.length > 12) histX.shift()
      if (histY.length > 12) histY.shift()
      if (-rawY >= LOCK_DISTANCE) {
        finish('lock')
        return
      }
      if (-rawX >= CANCEL_DISTANCE) {
        finish('cancel')
        return
      }
      // Тянут в одну сторону — вторая ось замирает: кнопка не гуляет по диагонали.
      const horizontal = -rawX > -rawY
      dx = horizontal ? rawX : rubberband(rawX, CANCEL_DISTANCE)
      dy = horizontal ? rubberband(rawY, LOCK_DISTANCE) : rawY
      paint(dx, dy)
    }

    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      if (ev.type === 'pointercancel') {
        finish('cancel')
        return
      }
      if (performance.now() - t0 < TAP_MS) {
        finish('tap')
        return
      }
      const projectedY = dy + projectMomentum(velocityFrom(histY))
      const projectedX = dx + projectMomentum(velocityFrom(histX))
      if (-projectedY >= LOCK_DISTANCE) finish('lock')
      else if (-projectedX >= CANCEL_DISTANCE) finish('cancel')
      else finish('send')
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    detach.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      detach.current = null
    }
  }

  return { holding, buttonRef, lockRef, hintRef, onPointerDown }
}
