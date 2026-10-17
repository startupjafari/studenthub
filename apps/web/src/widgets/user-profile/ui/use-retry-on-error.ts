'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { toApiError } from '../../../shared/lib'

// Коды, после которых повтор имеет смысл: сбой сервера или сети, перегрузка (429), техработы.
// Остальные ошибки (нет прав, не найдено, неверный запрос) повтор не исправит.
const RETRIABLE = new Set<string>(['INTERNAL_ERROR', 'RATE_LIMIT', 'MAINTENANCE'])
// Паузы между повторами растут вдвое: 5, 10, 20, 40, 60 с — и на этом попытки кончаются.
const BASE_DELAY_MS = 5_000
const MAX_DELAY_MS = 60_000
export const MAX_RETRY_ATTEMPTS = 5

/** Пауза перед повтором номер `attempt` (с нуля). */
export function retryDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
}

interface FailingQuery {
  isError: boolean
  isFetching: boolean
  error: unknown
  refetch: () => Promise<unknown>
}

/**
 * Ошибка загрузки вкладки профиля: один тост на эпизод и тихие повторы с растущей паузой.
 *
 * Раньше тост и повтор шли каждые 5 секунд, пока открыт экран, — в том числе на 429, когда
 * повторы только продлевают ограничение. Теперь ошибка, которую повтор не исправит, и
 * исчерпанные попытки останавливают цикл: хук возвращает `failed`, и вкладка показывает
 * ошибку на месте с кнопкой повтора (`retry`) вместо вечного скелетона.
 *
 * Решение принимается, когда запрос завершён (`isFetching` = false): следующая пауза
 * отсчитывается от ответа на предыдущий повтор, а ручной повтор не «падает» раньше ответа.
 */
export function useRetryOnError(
  query: FailingQuery,
  message: string,
): { failed: boolean; retry: () => void } {
  const { isError, isFetching, error, refetch } = query
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const toasted = useRef(false)

  // Данные пришли — эпизод ошибки закончен, следующая ошибка начнёт отсчёт заново.
  useEffect(() => {
    if (isError) return
    setAttempt(0)
    setFailed(false)
    toasted.current = false
  }, [isError])

  useEffect(() => {
    if (!isError || isFetching || failed) return
    if (!RETRIABLE.has(toApiError(error).code) || attempt >= MAX_RETRY_ATTEMPTS) {
      setFailed(true)
      return
    }
    // Предупреждение — один раз на эпизод: дальше повторы идут молча.
    if (!toasted.current) {
      toasted.current = true
      toast.error(message)
    }
    const id = window.setTimeout(() => {
      setAttempt((n) => n + 1)
      void refetch()
    }, retryDelay(attempt))
    return () => window.clearTimeout(id)
  }, [isError, isFetching, error, attempt, failed, refetch, message])

  // Ручной повтор с экрана ошибки: новый отсчёт попыток.
  const retry = useCallback(() => {
    setAttempt(0)
    setFailed(false)
    void refetch()
  }, [refetch])

  return { failed, retry }
}
