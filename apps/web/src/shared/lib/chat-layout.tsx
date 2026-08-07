'use client'

import { createContext, useContext } from 'react'

// Слот в сайдбаре, куда экран чатов (десктоп) порталит панель списка чатов.
// Так список живёт визуально в AppSidebar, но остаётся частью дерева ChatWindow —
// всё общее состояние (activeId, мутации, диалоги) не приходится «поднимать».
//
// setChatOpen — экран чатов сообщает оболочке, что открыт конкретный чат: на мобильном
// это полноэкранная поверхность, и глобальная нижняя навигация должна скрыться (иначе она
// перекрывает поле ввода сообщения).
type ChatLayoutValue = {
  listSlot: HTMLElement | null
  setChatOpen?: (open: boolean) => void
}

const ChatLayoutContext = createContext<ChatLayoutValue>({ listSlot: null })

export const ChatLayoutProvider = ChatLayoutContext.Provider

export function useChatListSlot(): HTMLElement | null {
  return useContext(ChatLayoutContext).listSlot
}

export function useSetChatOpen(): ((open: boolean) => void) | undefined {
  return useContext(ChatLayoutContext).setChatOpen
}
