'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_CHAT_REACTION } from '@studenthub/shared-config'
import type { ChatSettingsResponse } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import { useRealtimeEvent } from '../../../shared/realtime'

// Личные настройки чатов (`/chats/settings`): своя быстрая реакция — та, что ставит двойной
// клик или двойное касание по сообщению (как «Быстрая реакция» в Telegram).

export const chatSettingsKey = ['chats', 'settings'] as const

export async function fetchChatSettings(): Promise<ChatSettingsResponse> {
  const { data } = await api.get<ChatSettingsResponse>('/chats/settings')
  return data
}

/** `null` — вернуть общую по умолчанию; сервер отвечает уже подставленным значением. */
export async function updateChatSettingsRequest(input: {
  defaultReaction: string | null
}): Promise<ChatSettingsResponse> {
  const { data } = await api.patch<ChatSettingsResponse>('/chats/settings', input)
  return data
}

/**
 * Сигнал `chat:settings-changed` переносит смену на другие вкладки и устройства без
 * перезагрузки. Слушатель один на экран чатов — не в каждом потребителе настройки.
 */
export function useChatSettingsSync(): void {
  const qc = useQueryClient()
  useRealtimeEvent<ChatSettingsResponse>('chat:settings-changed', (payload) => {
    if (payload?.defaultReaction) qc.setQueryData(chatSettingsKey, payload)
  })
}

/**
 * Быстрая реакция и её смена. Пока настройки не пришли (или запрос упал), реакция — общая по
 * умолчанию: двойной клик не должен молчать из-за сети. Смена — оптимистичная.
 */
export function useDefaultReaction() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: chatSettingsKey,
    queryFn: fetchChatSettings,
    // Настройка меняется только руками и приходит сигналом — перечитывать её незачем.
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationFn: (emoji: string | null) => updateChatSettingsRequest({ defaultReaction: emoji }),
    onMutate: async (emoji) => {
      await qc.cancelQueries({ queryKey: chatSettingsKey })
      const prev = qc.getQueryData<ChatSettingsResponse>(chatSettingsKey)
      qc.setQueryData<ChatSettingsResponse>(chatSettingsKey, {
        defaultReaction: emoji ?? DEFAULT_CHAT_REACTION,
      })
      return { prev }
    },
    onError: (_e, _emoji, ctx) => {
      if (ctx?.prev) qc.setQueryData(chatSettingsKey, ctx.prev)
    },
    onSuccess: (data) => qc.setQueryData(chatSettingsKey, data),
  })

  return {
    defaultReaction: query.data?.defaultReaction ?? DEFAULT_CHAT_REACTION,
    isLoading: query.isLoading,
    setDefaultReaction: mutation.mutate,
    isSaving: mutation.isPending,
  }
}
