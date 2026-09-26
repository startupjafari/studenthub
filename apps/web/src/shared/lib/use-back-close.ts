'use client'

import { useEffect, useRef } from 'react'

/**
 * Системная кнопка «назад» закрывает overlay, а не приложение.
 *
 * В установленном PWA на Android «назад» из корня выходит из приложения целиком. Если
 * открыта модалка, которой нет в истории, жест закрывает всё — человек теряет экран
 * вместо того, чтобы закрыть окно. Поэтому на время жизни overlay кладём в историю
 * запись-пустышку (URL не меняется) и закрываемся по `popstate`.
 *
 * Закрытие крестиком или Esc снимает запись обратно, иначе «назад» уводила бы на
 * пустой шаг. Если к моменту размонтирования верхняя запись уже не наша — значит из
 * окна ушли по ссылке, и трогать историю нельзя: `back()` отменил бы переход.
 *
 * Снятие записи отложено на макрозадачу — из-за StrictMode. В dev (`reactStrictMode: true`)
 * React монтирует эффект дважды: setup → cleanup → setup, на том же экземпляре компонента.
 * Если снимать запись синхронно в cleanup, `history.back()` уходит в очередь браузера, а
 * `popstate` от него прилетает уже во ВТОРОЙ setup — тот вызывает `onClose`, и окно
 * закрывается в тот же кадр, в который открылось. Наружу это выглядит как «модалки не
 * открываются вообще». Отложенное снятие второй setup успевает отменить (таймер лежит в
 * `ref`, а он у повторно смонтированного экземпляра сохраняется), при настоящем закрытии
 * отменять некому — и запись снимается как раньше.
 *
 * Окна бывают вложенными: из поста открывают пересылку или жалобу. `popstate` получают
 * все открытые окна сразу, а снятие записи вложенного окна (закрыли крестиком) — тоже
 * `popstate`. Раньше на него закрывался и пост под ним. Поэтому в записи лежит вся цепочка
 * открытых окон (`shOverlays`), и окно закрывается, только если его id в текущей записи
 * больше нет: «назад» снимает ровно верхнее окно, а родитель остаётся.
 */

type OverlayState = { shOverlay?: string; shOverlays?: string[] } | null

function overlayStack(): string[] {
  return (window.history.state as OverlayState)?.shOverlays ?? []
}

let counter = 0

export function useBackClose(onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Живут дольше одного прогона эффекта: id нашей записи в истории и отложенное её снятие.
  const idRef = useRef<string | null>(null)
  const undoRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (undoRef.current) {
      // Повторный монтаж того же экземпляра: запись из прошлого setup ещё в истории —
      // отменяем её снятие и переиспользуем, нового pushState не делаем.
      clearTimeout(undoRef.current)
      undoRef.current = null
    } else {
      const id = `overlay-${++counter}`
      idRef.current = id
      // Тем же URL: адресная строка и роут не меняются, меняется только длина истории.
      window.history.pushState(
        { ...window.history.state, shOverlay: id, shOverlays: [...overlayStack(), id] },
        '',
      )
    }

    let closedByBack = false
    const onPop = (): void => {
      // Сняли запись окна поверх нашего — наша ещё в истории, закрываться не нам.
      if (idRef.current && overlayStack().includes(idRef.current)) return
      closedByBack = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      // Ушли по «назад» — запись уже снял браузер, делать нечего.
      if (closedByBack) {
        idRef.current = null
        return
      }
      undoRef.current = setTimeout(() => {
        undoRef.current = null
        const current = (window.history.state as OverlayState)?.shOverlay
        if (current === idRef.current) window.history.back()
        idRef.current = null
      }, 0)
    }
  }, [])
}
