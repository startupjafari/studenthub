'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useAppSelector } from '../../../shared/store'
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
  const { data } = usePlatformStateQuery()
  return data ?? PLATFORM_STATE_DEFAULT
}

/**
 * То же состояние, но `undefined`, пока ответа ещё не было. Для решений, которые нельзя
 * принять «по умолчанию» и тут же отменить: окно «Что нового» по `announcedVersion`
 * (B-F18) иначе успело бы открыться до ответа и закрыться после. Сервер не ответил вовсе —
 * значение по умолчанию: ждать вечно хуже, чем решить без рычага.
 */
export function useLoadedPlatformState(): PlatformState | undefined {
  const { data, isError } = usePlatformStateQuery()
  if (data) return data
  return isError ? PLATFORM_STATE_DEFAULT : undefined
}

function usePlatformStateQuery() {
  const viewerId = useAppSelector((s) => s.auth.user?.id ?? null)
  return useQuery({
    queryKey: platformKeys.state(viewerId),
    queryFn: fetchPlatformState,
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
    retry: 1,
    // При входе и выходе ключ меняется: пока ответ для нового смотрящего не пришёл,
    // держим прежний — иначе техработы на миг сменились бы «всё работает».
    placeholderData: keepPreviousData,
  })
}
