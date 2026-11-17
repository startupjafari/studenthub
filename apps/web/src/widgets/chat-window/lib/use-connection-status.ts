'use client'

import { useEffect, useRef, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { chatKeys } from '../../../entities/chat'

/**
 * Состояние связи для заголовка списка чатов (как в Telegram):
 *  · `waitingForNetwork` — у браузера нет сети вовсе;
 *  · `connecting` — сеть есть, сокет ещё не поднялся;
 *  · `updating` — связь вернулась, догоняем пропущенное (идут запросы чатов);
 *  · `online` — всё в порядке, заголовок обычный.
 */
export type ConnectionStatus = 'online' | 'waitingForNetwork' | 'connecting' | 'updating'

/**
 * Не показываем короткие провалы: сокет при загрузке страницы поднимается за доли секунды,
 * и мигание «Соединение…» на каждом открытии экрана читалось бы как сбой.
 */
const SHOW_DELAY_MS = 400
/** Если запросы после реконнекта так и не начались — «Обновление…» снимаем сами. */
const NO_FETCH_GRACE_MS = 1500
/** Потолок «Обновления…»: зависший запрос не должен держать надпись вечно. */
const UPDATING_MAX_MS = 10_000

export function useConnectionStatus(socketConnected: boolean): ConnectionStatus {
  const [browserOnline, setBrowserOnline] = useState(true)
  useEffect(() => {
    const update = (): void => setBrowserOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // «Обновление…» — от восстановления сокета до конца запросов, которые оно вызвало
  // (догон переписки по seq, общий ресинк списка). Запросы считаем по ключу всех чатов.
  const [syncing, setSyncing] = useState(false)
  const wasConnectedRef = useRef(socketConnected)
  useEffect(() => {
    const was = wasConnectedRef.current
    wasConnectedRef.current = socketConnected
    if (!socketConnected) {
      setSyncing(false)
      return
    }
    if (was) return
    setSyncing(true)
    const timer = window.setTimeout(() => setSyncing(false), UPDATING_MAX_MS)
    return () => window.clearTimeout(timer)
  }, [socketConnected])

  const fetching = useIsFetching({ queryKey: chatKeys.all })
  const sawFetchRef = useRef(false)
  useEffect(() => {
    if (!syncing) {
      sawFetchRef.current = false
      return
    }
    if (fetching > 0) {
      sawFetchRef.current = true
      return
    }
    const timer = window.setTimeout(
      () => setSyncing(false),
      sawFetchRef.current ? 0 : NO_FETCH_GRACE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [syncing, fetching])

  const raw: ConnectionStatus = !browserOnline
    ? 'waitingForNetwork'
    : !socketConnected
      ? 'connecting'
      : syncing
        ? 'updating'
        : 'online'

  // Показанное состояние: в «онлайн» — сразу, из «онлайн» в проблему — с задержкой, между
  // проблемами — сразу (надпись уже на экране, ей незачем снова ждать).
  const [shown, setShown] = useState<ConnectionStatus>('online')
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => {
    if (raw === 'online' || shownRef.current !== 'online') {
      setShown(raw)
      return
    }
    const timer = window.setTimeout(() => setShown(raw), SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [raw])

  return shown
}
