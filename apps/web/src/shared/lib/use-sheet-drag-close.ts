'use client'

import { useEffect, useRef, type RefObject } from 'react'
import {
  createSpring,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
  type SpringHandle,
} from './spring'

interface Options {
  /**
   * Затемнение под шторкой. Передан — гаснет вместе с ней: прозрачность привязана к
   * смещению на всём пути, и при драге, и при доводке. Без него фон оставался бы плотным
   * до самого конца, и лист «проваливался» бы в тёмный экран.
   */
  backdropRef?: RefObject<HTMLElement | null>
  /** Доля высоты листа, за которой отпускание закрывает (по спроецированной точке). */
  closeFraction?: number
  /** Порог начала драга (px) — чтобы не реагировать на микродвижения и тапы. */
  startThreshold?: number
}

// Жест «потянуть шторку вниз, чтобы закрыть» для BottomSheet/ActionSheet.
//
// Физика — apple-design §2–§6, §9:
//  · слежение 1:1 за указателем, с учётом того, ГДЕ схватили (Pointer Events + capture,
//    поэтому работает и мышью, и стилусом, и когда палец ушёл за пределы листа);
//  · вверх лист тянется с нарастающим сопротивлением (резина), а не упирается в стену;
//  · решение «закрыть или вернуть» принимается по СПРОЕЦИРОВАННОЙ точке остановки, а не по
//    текущей: короткий быстрый флик закрывает, долгое медленное перетаскивание — нет;
//  · доводка — пружина, стартующая со скоростью пальца, поэтому шва между жестом и
//    анимацией нет;
//  · **лист можно поймать в любой момент доводки** и потащить обратно. Это главное: раньше
//    здесь стоял флаг `settling`, который глушил новые касания до конца анимации.
//
// touchmove держим отдельным нативным слушателем с `{ passive: false }` только ради
// preventDefault: Pointer Events сами по себе не мешают браузеру прокручивать страницу, а
// без этого жест параллельно уходит в документ (iOS pull-to-refresh).

/** Пружина доводки: лёгкий перелёт уместен — жест сам нёс инерцию (§4, «Drawer / sheet»). */
const SHEET_DAMPING = 0.8
const SHEET_RESPONSE = 0.3

export function useSheetDragClose<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  options: Options = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const backdropRef = options.backdropRef

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const backdrop = backdropRef?.current ?? null
    const closeFraction = options.closeFraction ?? 0.4
    const startThreshold = options.startThreshold ?? 6

    const height = (): number => el.offsetHeight || 1

    // Единственная точка правды о положении листа: и драг, и пружина пишут сюда.
    const render = (y: number): void => {
      el.style.transform = y === 0 ? '' : `translateY(${y}px)`
      if (backdrop) backdrop.style.opacity = String(Math.max(0, 1 - y / height()))
    }

    let closing = false
    const spring: SpringHandle = createSpring({
      from: 0,
      damping: SHEET_DAMPING,
      response: SHEET_RESPONSE,
      onChange: render,
      onRest: () => {
        if (closing) onCloseRef.current()
      },
    })

    let dragging = false
    let pointerId: number | null = null
    let grabY = 0 // положение листа в момент захвата
    let startPointer = 0
    let passedThreshold = false
    let history: { position: number; time: number }[] = []

    const onPointerDown = (e: PointerEvent): void => {
      // Мышью тянем только основной кнопкой; правый клик — контекстное меню.
      if (e.button !== 0) return
      // Лист едет — перехватываем его на текущем месте. Именно это делает анимацию
      // прерываемой: пружина гасится, а драг продолжается оттуда, где лист сейчас.
      const catching = spring.animating
      if (!catching && el.scrollTop > 0) return // обычная прокрутка контента — не наш жест
      closing = false
      spring.stop()
      dragging = true
      pointerId = e.pointerId
      grabY = spring.value
      startPointer = e.clientY
      // Пойманный на лету лист уже «в жесте» — порог движения ему не нужен.
      passedThreshold = catching
      history = [{ position: e.clientY, time: e.timeStamp }]
      el.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging || e.pointerId !== pointerId) return
      const delta = e.clientY - startPointer
      history.push({ position: e.clientY, time: e.timeStamp })
      if (history.length > 8) history.shift()

      if (!passedThreshold) {
        // Вверх от закрытого положения жеста нет — это прокрутка контента.
        if (delta < startThreshold) return
        passedThreshold = true
      }
      const raw = grabY + delta
      // Выше открытого положения лист не поднимается, но и не упирается: резина.
      spring.set(raw >= 0 ? raw : -rubberband(-raw, height()))
      render(spring.value)
    }

    const settle = (): void => {
      const y = spring.value
      const velocity = velocityFrom(history)
      // Куда лист доехал бы сам, если его отпустить (§6). Решение по проекции, а не по
      // текущей точке: короткий резкий флик закрывает, вялое перетаскивание на ту же
      // дистанцию — нет. Это и есть «маленький ввод → большой вывод».
      const projected = y + projectMomentum(velocity)
      closing = projected > height() * closeFraction

      if (prefersReducedMotion()) {
        // Уменьшенное движение: без броска и перелёта — сразу конечное состояние.
        spring.set(closing ? height() : 0)
        render(spring.value)
        if (closing) onCloseRef.current()
        return
      }
      // Скорость пальца становится начальной скоростью пружины — шва между жестом и
      // анимацией не остаётся (§5).
      spring.to(closing ? height() : 0, velocity)
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (!dragging || e.pointerId !== pointerId) return
      dragging = false
      pointerId = null
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!passedThreshold) return
      settle()
    }

    // Единственная задача — не отдать жест странице. Слушатель обязан быть non-passive,
    // иначе preventDefault игнорируется (React вешает passive).
    //
    // Блокируем с ПЕРВОГО движения вниз, не дожидаясь порога: иначе браузер успевает
    // счесть жест прокруткой, забирает его себе и присылает pointercancel — лист замирает
    // на полпути. Движение вверх не трогаем: при scrollTop === 0 это обычная прокрутка
    // содержимого шторки, и она должна работать.
    const blockScroll = (e: TouchEvent): void => {
      if (!dragging || !e.cancelable) return
      const y = e.touches[0]?.clientY
      if (y !== undefined && y > startPointer) e.preventDefault()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    el.addEventListener('touchmove', blockScroll, { passive: false })
    return () => {
      spring.stop()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('touchmove', blockScroll)
    }
  }, [options.closeFraction, options.startThreshold, backdropRef])

  return ref
}
