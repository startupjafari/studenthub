'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Черновики набранного текста (пост, статья) в хранилище браузера.
 *
 * Зачем на устройстве, а не на сервере: черновик пишется на каждую паузу в наборе, и
 * запрос на сервер на каждую паузу — лишняя нагрузка ради текста, который через минуту
 * опубликуют. Перезагрузка вкладки или случайное закрытие окна не должны съедать набранное.
 *
 * Это не данные сессии (токенов тут нет, FRONTEND_RULES §15 п.1), но это чужой текст на
 * общем компьютере: ключ привязан к пользователю, а выход и вход другого человека стирают
 * все черновики (`clearContentDrafts`, shared/session/device-data).
 */
const PREFIX = 'sh_draft:'

export interface StoredDraft<T> {
  value: T
  savedAt: number
}

/** Ключ черновика: пользователь + место (`post:new`, `article:<id>`). */
export function contentDraftKey(userId: string, scope: string): string {
  return `${PREFIX}${userId}:${scope}`
}

export function readContentDraft<T>(key: string): StoredDraft<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDraft<T>
    return parsed && typeof parsed.savedAt === 'number' ? parsed : null
  } catch {
    return null
  }
}

/** false — хранилище недоступно или переполнено: интерфейс показывает «не сохранено». */
export function writeContentDraft<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function removeContentDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Приватный режим без хранилища: стирать нечего.
  }
}

/** Стереть все черновики на устройстве — при выходе и при входе другого человека. */
export function clearContentDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    keys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Хранилище недоступно — черновиков в нём и нет.
  }
}

export type LocalDraftStatus = 'idle' | 'pending' | 'saved' | 'error'

/**
 * Автосохранение значения в черновик с паузой после последней правки. `empty` — значение
 * без содержимого: черновик стирается, чтобы пустая форма не «восстанавливалась».
 * Возвращает статус для подписи «Сохранение… / Черновик сохранён / Не удалось сохранить».
 */
export function useLocalDraft<T>(
  key: string | null,
  value: T,
  { empty, delay = 600 }: { empty: boolean; delay?: number },
): LocalDraftStatus {
  const [status, setStatus] = useState<LocalDraftStatus>('idle')
  const first = useRef(true)
  const serialized = JSON.stringify(value)

  useEffect(() => {
    // Первая отрисовка — это восстановленное или начальное значение, не правка.
    if (first.current) {
      first.current = false
      return
    }
    if (!key) return
    if (empty) {
      removeContentDraft(key)
      setStatus('idle')
      return
    }
    setStatus('pending')
    const timer = setTimeout(() => {
      setStatus(writeContentDraft(key, JSON.parse(serialized) as T) ? 'saved' : 'error')
    }, delay)
    return () => clearTimeout(timer)
  }, [key, serialized, empty, delay])

  return status
}
