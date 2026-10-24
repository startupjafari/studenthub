'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { patchCachedPost, toggleBookmarkRequest } from '../../../entities/post'

/**
 * Сохранить пост в избранное и убрать обратно.
 *
 * Оптимистично, с откатом (FRONTEND_RULES §5.5): нажатие на закладку обязано отвечать
 * мгновенно — это личное действие, его результат не зависит ни от кого, кроме сервера,
 * и ждать ответа сети, чтобы увидеть залитую иконку, нечего.
 *
 * Ответ сервера принимается как истина поверх своего предположения: переключатель на
 * сервере идемпотентен, и при двух быстрых нажатиях подряд прав он, а не мы.
 *
 * Состояние пишется и в кэш постов (patchCachedPost): карточка в ленте и полный просмотр —
 * два экземпляра хука на один пост, и без общего источника второй жил со старым `initial`.
 * Переключатель на сервере тогда срабатывал ещё раз — «Сохранить» снимало закладку.
 */
export function useBookmark(postId: string, initial: boolean) {
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [bookmarked, setBookmarked] = useState(initial)
  const [pending, setPending] = useState(false)

  // Лента переиспользует карточки между страницами и табами: без синхронизации
  // состояние осталось бы от предыдущего поста в том же слоте.
  useEffect(() => setBookmarked(initial), [initial, postId])

  const toggle = useCallback(() => {
    const prev = bookmarked
    const apply = (value: boolean): void => {
      setBookmarked(value)
      patchCachedPost(qc, postId, (post) => ({ ...post, bookmarked: value }))
    }
    apply(!prev)
    setPending(true)
    toggleBookmarkRequest(postId)
      .then(apply)
      .catch(() => {
        apply(prev)
        toast.error(tErr('INTERNAL_ERROR'))
      })
      .finally(() => setPending(false))
  }, [bookmarked, postId, qc, tErr])

  return { bookmarked, pending, toggle }
}
