'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

// При ошибке загрузки показываем тост-предупреждение; ПОВТОРНЫЙ запрос делаем тогда,
// когда действие тоста завершилось (авто-закрытие/закрытие пользователем). Если данные
// всё ещё не пришли — цикл повторяется. Пока данные не загрузятся, компонент показывает скелетон.
export function useRetryOnError(
  isError: boolean,
  refetch: () => Promise<unknown>,
  message: string,
): void {
  useEffect(() => {
    if (!isError) return
    let cancelled = false

    const cycle = (): void => {
      if (cancelled) return
      let done = false // защита от двойного вызова (onAutoClose + onDismiss)
      const retry = (): void => {
        if (cancelled || done) return
        done = true
        Promise.resolve(refetch())
          .then((res) => {
            if (cancelled) return
            const stillError = (res as { isError?: boolean } | undefined)?.isError !== false
            if (stillError) cycle() // не загрузилось — новый тост и следующая попытка
          })
          .catch(() => {
            if (!cancelled) cycle()
          })
      }
      // Тост живёт 5 сек; повтор — по завершении (авто-закрытие или ручное).
      toast.error(message, { duration: 5000, onAutoClose: retry, onDismiss: retry })
    }

    cycle()
    return () => {
      cancelled = true
    }
  }, [isError, refetch, message])
}
