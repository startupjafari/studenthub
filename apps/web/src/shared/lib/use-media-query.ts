'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Реактивный медиазапрос.
 *
 * Через `useSyncExternalStore`, а не `useState` + `useEffect`: React обязан отрисовать при
 * гидрации ровно то же, что пришло с сервера. Прежняя версия читала `window.matchMedia`
 * синхронно в ленивом инициализаторе состояния — на широком экране первый клиентский рендер
 * получал `true` против серверного `false`, и React ронял «Hydration failed…», перерисовывая
 * поддерево целиком (в чатах это `<aside>` с деталями диалога).
 *
 * `getServerSnapshot` возвращает то же `false`, что и SSR, поэтому разметка совпадает.
 * Настоящее значение React забирает сразу после гидрации, до отрисовки кадра, — раскладка
 * не «мелькает», ради чего инициализатор и появился.
 */

/** Стабильная ссылка: React сравнивает `getServerSnapshot` между рендерами. */
const serverSnapshot = (): boolean => false

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onStoreChange)
      return () => mql.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot)
}
