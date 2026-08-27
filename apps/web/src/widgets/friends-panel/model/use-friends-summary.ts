'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchFriendCount, friendKeys } from '../../../entities/friendship'

/**
 * Есть ли что показывать в блоке друзей.
 *
 * Нужен снаружи, а не только внутри панели: страница ленты подгоняет под колонку
 * ширину всей связки «лента + колонка», и решать это по факту наличия карточек поздно —
 * пустая колонка сдвинула бы ленту влево ради ничего. Запрос счётчиков один и тот же,
 * react-query отдаёт его обоим потребителям из кэша.
 */
export function useFriendsSummary() {
  const countQ = useQuery({ queryKey: friendKeys.count(), queryFn: fetchFriendCount })
  const counts = countQ.data
  return {
    counts,
    friends: counts?.friends ?? 0,
    incoming: counts?.incomingRequests ?? 0,
    hasAny: !!counts && (counts.friends > 0 || counts.incomingRequests > 0),
  }
}
