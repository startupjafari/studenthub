'use client'

import { createContext, useContext } from 'react'

// Слот в сайдбаре, куда экран чатов (десктоп) порталит панель списка чатов.
// Так список живёт визуально в AppSidebar, но остаётся частью дерева ChatWindow —
// всё общее состояние (activeId, мутации, диалоги) не приходится «поднимать».
type ChatLayoutValue = {
  listSlot: HTMLElement | null
}

const ChatLayoutContext = createContext<ChatLayoutValue>({ listSlot: null })

export const ChatLayoutProvider = ChatLayoutContext.Provider

export function useChatListSlot(): HTMLElement | null {
  return useContext(ChatLayoutContext).listSlot
}
