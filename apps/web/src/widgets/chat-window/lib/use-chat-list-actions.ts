'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MARK_READ_BATCH_MAX } from '@studenthub/shared-schemas'
import {
  chatKeys,
  markChatsReadRequest,
  setChatMarkedUnreadRequest,
  setPinnedChatsOrderRequest,
  sortChats,
  type ChatListItem,
} from '../../../entities/chat'
import { useErrorToast } from '../../../shared/lib'
import { useRealtimeEvent } from '../../../shared/realtime'

/**
 * Действия левой колонки, которых у окна чата нет: пометка «как новое», прочтение папки
 * целиком и синхронизация личных настроек списка с другими устройствами.
 *
 * Живут рядом со списком, а не в `ChatWindow`: ни переписке, ни её шапке они не нужны, а
 * мутация с оптимистичным кэшем — ровно то, что список и так читает из `chatKeys.list()`.
 */
export function useChatListActions() {
  const qc = useQueryClient()
  const errorToast = useErrorToast('chat-list-action')

  const patchList = (fn: (c: ChatListItem) => ChatListItem): ChatListItem[] | undefined => {
    const prev = qc.getQueryData<ChatListItem[]>(chatKeys.list())
    qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) => old?.map(fn))
    return prev
  }

  const settle = (): void => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
    void qc.invalidateQueries({ queryKey: chatKeys.unread() })
  }

  // «Пометить как непрочитанное» и обратно. Флаг ставим сразу — точка в строке и есть ответ
  // на нажатие; ответа сервера ждать незачем.
  const markUnread = useMutation({
    mutationFn: ({ chatId, marked }: { chatId: string; marked: boolean }) =>
      setChatMarkedUnreadRequest(chatId, marked),
    onMutate: async ({ chatId, marked }) => {
      await qc.cancelQueries({ queryKey: chatKeys.list() })
      return { prev: patchList((c) => (c.id === chatId ? { ...c, markedUnread: marked } : c)) }
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(chatKeys.list(), ctx.prev)
      errorToast.show(e)
    },
    onSettled: settle,
  })

  // «Прочитать все» в папке: чаты уходят пачками по пределу эндпоинта, счётчики гаснут сразу.
  const readAll = useMutation({
    mutationFn: async (chatIds: string[]) => {
      for (let i = 0; i < chatIds.length; i += MARK_READ_BATCH_MAX) {
        await markChatsReadRequest(chatIds.slice(i, i + MARK_READ_BATCH_MAX))
      }
    },
    onMutate: async (chatIds) => {
      await qc.cancelQueries({ queryKey: chatKeys.list() })
      const ids = new Set(chatIds)
      return {
        prev: patchList((c) => (ids.has(c.id) ? { ...c, unreadCount: 0, markedUnread: false } : c)),
      }
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(chatKeys.list(), ctx.prev)
      errorToast.show(e)
    },
    onSettled: settle,
  })

  // Порядок закреплённых (перетаскивание): список встаёт в новый порядок сразу, сервер
  // догоняет. Ошибка — откат к прежнему порядку (строки съедут обратно перестановкой).
  const reorderPinned = useMutation({
    mutationFn: (chatIds: string[]) => setPinnedChatsOrderRequest(chatIds),
    onMutate: async (chatIds) => {
      await qc.cancelQueries({ queryKey: chatKeys.list() })
      const prev = qc.getQueryData<ChatListItem[]>(chatKeys.list())
      const order = new Map(chatIds.map((id, i) => [id, i]))
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        old
          ? sortChats(
              old.map((c) =>
                c.pinnedAt && order.has(c.id) ? { ...c, pinnedOrder: order.get(c.id) } : c,
              ),
            )
          : old,
      )
      return { prev }
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(chatKeys.list(), ctx.prev)
      errorToast.show(e)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: chatKeys.list() }),
  })

  // Пометку, закрепление, их порядок и mute папки поменяли на другом устройстве — сервер
  // шлёт об этом только мне. Список перечитываем: в событии лишь id, а не новые значения.
  useRealtimeEvent('chat:list-changed', () => {
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  })

  return {
    setMarkedUnread: (chatId: string, marked: boolean) => markUnread.mutate({ chatId, marked }),
    readAll: (chatIds: string[]) => {
      if (chatIds.length > 0) readAll.mutate(chatIds)
    },
    /** Новый порядок закреплённых сверху вниз (полный — см. lib/pinned-order). */
    reorderPinned: (chatIds: string[]) => {
      if (chatIds.length > 0) reorderPinned.mutate(chatIds)
    },
  }
}
