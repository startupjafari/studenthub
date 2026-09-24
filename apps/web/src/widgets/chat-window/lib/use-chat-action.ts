'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { ChatAction } from '@studenthub/shared-schemas'
import { ACTION_REPEAT_MS } from './chat-actions'

/**
 * Отправка «я сейчас это делаю» в чат.
 *
 * Два режима, потому что действия бывают двух природ:
 *
 * - `ping` — действие подтверждается самим человеком. Набор текста: на каждое нажатие клавиши
 *   зовём `ping`, хук троттлит отправку, а когда человек перестал печатать, ничего звать не
 *   надо — подпись погаснет у получателя по таймауту сама. Это дешевле явного «стоп» и
 *   переживает закрытие вкладки.
 * - `begin`/`end` — действие длится само, нажатий нет. Запись голосового и загрузка файла:
 *   хук сам повторяет подтверждение, пока не позовут `end`.
 *
 * Чат запоминается в момент старта. Без этого «стоп» при переключении диалога уходил бы в
 * новый чат, а в старом подпись висела бы до таймаута.
 */
export interface ChatActionSender {
  /** Человек продолжает действие (набирает текст). Троттлится внутри. */
  ping: (chatId: string, action: ChatAction) => void
  /** Действие началось и длится само — хук будет подтверждать его, пока не позовут `end`. */
  begin: (chatId: string, action: ChatAction) => void
  /** Действие закончилось. Повторный вызов без активного действия ничего не шлёт. */
  end: () => void
}

export function useChatActionSender(
  send: (chatId: string, action: ChatAction | null) => void,
): ChatActionSender {
  const sendRef = useRef(send)
  sendRef.current = send

  const chatIdRef = useRef<string | null>(null)
  const actionRef = useRef<ChatAction | null>(null)
  const sentAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  return useMemo<ChatActionSender>(() => {
    const stopTimer = (): void => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    const emit = (chatId: string, action: ChatAction | null): void => {
      chatIdRef.current = action === null ? null : chatId
      actionRef.current = action
      sentAtRef.current = Date.now()
      sendRef.current(chatId, action)
    }

    const end = (): void => {
      stopTimer()
      const chatId = chatIdRef.current
      if (actionRef.current === null || !chatId) return
      emit(chatId, null)
    }

    return {
      ping: (chatId, action) => {
        // Сменились чат или действие — сообщаем сразу, иначе получатель несколько секунд
        // видел бы прежнюю подпись.
        if (chatIdRef.current !== chatId || actionRef.current !== action) {
          stopTimer()
          emit(chatId, action)
          return
        }
        if (Date.now() - sentAtRef.current >= ACTION_REPEAT_MS) emit(chatId, action)
      },

      begin: (chatId, action) => {
        if (chatIdRef.current === chatId && actionRef.current === action && timerRef.current) return
        stopTimer()
        emit(chatId, action)
        timerRef.current = setInterval(() => emit(chatId, action), ACTION_REPEAT_MS)
      },

      end,
    }
  }, [])
}

/** Снять действие при размонтировании: уход со страницы чата — это тоже «закончил». */
export function useEndChatActionOnUnmount(sender: ChatActionSender): void {
  const senderRef = useRef(sender)
  senderRef.current = sender
  useEffect(() => () => senderRef.current.end(), [])
}
