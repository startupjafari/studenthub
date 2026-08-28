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
 */

let counter = 0

export function useBackClose(onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = `overlay-${++counter}`
    // Тем же URL: адресная строка и роут не меняются, меняется только длина истории.
    window.history.pushState({ ...window.history.state, shOverlay: id }, '')

    let closedByBack = false
    const onPop = (): void => {
      closedByBack = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      const current = (window.history.state as { shOverlay?: string } | null)?.shOverlay
      if (!closedByBack && current === id) window.history.back()
    }
  }, [])
}
