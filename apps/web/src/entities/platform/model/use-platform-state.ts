'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchPlatformState, platformKeys } from '../api/platform-api'
import { PLATFORM_STATE_DEFAULT, type PlatformState } from './state'

// Опрос раз в минуту, а не однократное чтение при загрузке.
//
// Объявление о техработах адресовано в первую очередь тем, кто УЖЕ внутри: у PWA с
// домашнего экрана вкладка живёт неделями и заново страницу не запрашивает. Без опроса
// предупреждение увидели бы только те, кто зашёл после его публикации, — то есть как раз
// не те, кого прервёт остановка.
const POLL_INTERVAL_MS = 60_000

/**
 * Состояние платформы. Пока ответа нет — платформа считается живой: недоступный API не
 * должен превращаться в режим техработ, иначе сетевой сбой у одного человека покажет ему
 * заглушку вместо работающего приложения.
 */
export function usePlatformState(): PlatformState {
  const { data } = useQuery({
    queryKey: platformKeys.state(),
    queryFn: fetchPlatformState,
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
    retry: 1,
  })

  return data ?? PLATFORM_STATE_DEFAULT
}
