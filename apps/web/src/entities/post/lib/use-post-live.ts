'use client'

import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { useLiveRefresh, useRealtimeEnvelope } from '../../../shared/realtime'
import { useAppSelector } from '../../../shared/store'
import { fetchPost, postKeys } from '../api/post-api'
import { patchCachedPost } from '../model/cache'
import { reactionSummaryOf } from '../model/reactions'
import {
  isPostCached,
  removeCachedPost,
  withServerTotals,
  type FeedPostChangedSignal,
  type FeedPostCreatedSignal,
} from '../model/live'
import type { PostAudienceValue } from '../model/types'

// Живая лента (эпик «всё живое по сокету», docs/PROJECT.md §9.2d). Сервер шлёт сигналы без
// содержимого: пост вышел, изменился, у него новые счётчики или комментарии. Лента правит
// кэш на месте (счётчики), перечитывает изменённый пост или убирает удалённый — читающий
// ничего не перезагружает, и лента под ним не прыгает.

/**
 * Держит закэшированные посты в актуальном виде: счётчики, правка, удаление, обсуждение.
 * Вешается на экраны, где посты на виду (лента, вкладка «Посты», страница поста, пост из
 * адреса). Повторное подключение на соседнем экране безвредно: счётчики ставятся числом,
 * а не прибавкой, и перечитывание поста склеивает сам кэш запросов.
 */
export function usePostLiveCache({ enabled = true }: { enabled?: boolean } = {}): void {
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)

  /** Перечитать пост и подменить его во всех выдачах; недоступный — убрать, как удалённый. */
  const refreshPost = (id: string): void => {
    qc.fetchQuery({ queryKey: postKeys.detail(id), queryFn: () => fetchPost(id), staleTime: 0 })
      .then((fresh) => patchCachedPost(qc, id, () => fresh))
      .catch(() => removeCachedPost(qc, id))
  }

  useRealtimeEnvelope<FeedPostChangedSignal>(REALTIME_EVENTS.feedPostChanged, (envelope) => {
    if (!enabled) return
    const postId = envelope.entityId
    const signal = envelope.data
    if (signal.kind === 'counters') {
      // Числа — с сервера, свой лайк и закладка — свои: в сигнале нет признака «моя».
      patchCachedPost(qc, postId, (post) => ({
        ...post,
        reactionSummary: withServerTotals(reactionSummaryOf(post, myId), signal.reactions),
        _count: { ...post._count, comments: signal.comments },
      }))
      return
    }
    if (signal.kind === 'deleted') {
      removeCachedPost(qc, postId)
      // Открытая страница поста перечитает его и покажет «публикация недоступна».
      void qc.invalidateQueries({ queryKey: postKeys.detail(postId) })
      return
    }
    // Правка: перечитываем один пост и подменяем его во всех выдачах — не всю ленту.
    // Поста нет ни в одной выдаче — он у этого зрителя не на экране, читать нечего.
    if (!isPostCached(qc, postId)) return
    // После правки пост мог стать невидимым зрителю — тогда он убирается, как удалённый.
    refreshPost(postId)
  })

  // Обсуждение: перечитать открытую ветку; закрытая просто помечается устаревшей. Число у
  // карточки здесь не ставим — его приносит склеенный сигнал счётчиков: число из этого
  // сигнала может обогнать ответ на свой же комментарий, и прибавка в нём посчитала бы его
  // дважды.
  useLiveRefresh(
    REALTIME_EVENTS.postCommentsChanged,
    (envelope) => [postKeys.comments(envelope.entityId)],
    { enabled },
  )
}

/**
 * Виден ли зрителю пост этой аудитории, если сигнал дошёл до его комнаты. Комната вуза
 * общая на всех, а пост факультета или пост «для преподавателей» видят не все в ней: такой
 * сигнал без проверки обещал бы в плашке пост, которого после перечитывания не окажется.
 */
function visibility(audience: PostAudienceValue, role: Role | null): boolean | 'check' {
  switch (audience) {
    case 'ALL':
    case 'UNIVERSITY':
    case 'SUBJECT':
    case 'GROUP':
    case 'PERSONAL':
      return true
    case 'TEACHERS':
      return role === Role.TEACHER
    case 'FACULTY':
      // Факультета поста в сигнале нет — спрашиваем сам пост: сервер ответит по правам.
      return 'check'
    default:
      return false
  }
}

/**
 * Сколько новых постов вышло с момента показа ленты — для плашки «N новых публикаций».
 * Лента сама их не вставляет: читающий не теряет место, а по нажатию перечитывает и
 * поднимается наверх (`reset` — после этого).
 *
 * Свои посты не считаются: после публикации лента автора перечитывается сама.
 * `match` сужает подсчёт под экран (вкладка ленты, профиль автора).
 */
export function useNewPostsCount({
  match,
  enabled = true,
}: {
  match?: (signal: FeedPostCreatedSignal) => boolean
  enabled?: boolean
} = {}): { count: number; reset: () => void } {
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const role = useAppSelector((s) => s.auth.role)
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())
  const matchRef = useRef(match)
  matchRef.current = match

  useRealtimeEnvelope<FeedPostCreatedSignal>(REALTIME_EVENTS.feedPostCreated, (envelope) => {
    if (!enabled) return
    const signal = envelope.data
    if (!signal || signal.authorId === myId) return
    if (matchRef.current && !matchRef.current(signal)) return
    const postId = envelope.entityId
    const add = (): void => setIds((prev) => (prev.has(postId) ? prev : new Set([...prev, postId])))
    const visible = visibility(signal.audience, role)
    if (visible === true) add()
    else if (visible === 'check') {
      qc.fetchQuery({ queryKey: postKeys.detail(postId), queryFn: () => fetchPost(postId) })
        .then(add)
        .catch(() => undefined)
    }
  })

  const reset = useCallback(() => setIds(new Set()), [])
  return { count: ids.size, reset }
}
