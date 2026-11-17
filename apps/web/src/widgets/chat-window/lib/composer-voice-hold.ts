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
/**
 * Короче — это касание, а не удержание: запись не начинается вовсе, касание уходит в `onTap`
 * (переключение «голосовое ↔ кружок», как в Telegram). Запись стартует, только когда палец
 * продержался дольше, — иначе каждое переключение дёргало бы микрофон и камеру.
 */
const TAP_MS = 250
/** Палец уехал дальше до начала записи — это не касание и не удержание, а промах: ничего. */
const TAP_SLOP = 12

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
  /** Обработчик нажатия на кнопку записи: палец, перо и мышь (клавиатура — кликом). */
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
}

/**
 * Запись удержанием, как в Telegram на телефоне: держишь — пишется, отпустил — ушло; вверх до
 * замка — запись фиксируется и пальцы свободны; влево — отмена. Короткое нажатие не пишет, а
 * зовёт `onTap` — переключение голосового и кружка. Рекордер любой: голосовой или кружка, у
 * них общий контроллер.
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
  { onTap }: { onTap: () => void },
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
  const tapRef = useRef(onTap)
  tapRef.current = onTap

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
    if (e.button !== 0 || voiceRef.current.recording) return
    // Без этого браузер начнёт выделение текста или откроет меню долгого нажатия.
    e.preventDefault()
    detach.current?.()
    springs.current?.x.stop()
    springs.current?.y.stop()
    const pointerId = e.pointerId
    const x0 = e.clientX
    const y0 = e.clientY
    const histX: Point[] = []
    const histY: Point[] = []
    let dx = 0
    let dy = 0
    let done = false
    let started = false

    // Запись — только после TAP_MS удержания: короткое нажатие её не трогает вовсе.
    const startTimer = setTimeout(() => {
      started = true
      cancelOnStart.current = false
      setHolding(true)
      hapticTick()
      void voiceRef.current.start()
    }, TAP_MS)

    const finish = (outcome: 'send' | 'lock' | 'cancel' | 'tap'): void => {
      if (done) return
      done = true
      clearTimeout(startTimer)
      detach.current?.()
      if (!started) {
        // Запись не начиналась: касание — переключение, промах и отмена — ничего.
        if (outcome === 'tap') tapRef.current()
        return
      }
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
      settle(dx, dy, velocityFrom(histX), velocityFrom(histY))
    }

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      const now = performance.now()
      if (!started) {
        // До начала записи палец не ведёт кнопку; уехал далеко — это не касание.
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > TAP_SLOP) finish('cancel')
        return
      }
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
      if (!started) {
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
      // Размонтирование до начала записи не должно запустить её задним числом.
      clearTimeout(startTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      detach.current = null
    }
  }

  return { holding, buttonRef, lockRef, hintRef, onPointerDown }
}
