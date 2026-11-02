'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { contentOwnerKey, type ContentOwner } from '../../../entities/profile-content'

const ContentOwnerContext = createContext<ContentOwner | null>(null)

/**
 * Вкладки профиля по умолчанию показывают контент пользователя (`userId` в пропсах). Страница
 * компании оборачивает их в этот провайдер: те же списки и формы создания работают с её
 * контентом — другие запросы, ключи кэша и `?as=company`, без второй копии вкладок.
 */
export function ContentOwnerProvider({
  owner,
  children,
}: {
  owner: ContentOwner
  children: ReactNode
}) {
  return <ContentOwnerContext.Provider value={owner}>{children}</ContentOwnerContext.Provider>
}

/** Владелец контента вкладки: компания из провайдера или пользователь `userId`. */
export function useContentOwner(userId: string): ContentOwner {
  return useContext(ContentOwnerContext) ?? { kind: 'user', id: userId }
}

/** Владелец и его ключ кэша — вкладки берут оба. */
export function useOwnerKey(userId: string): { owner: ContentOwner; key: string } {
  const owner = useContentOwner(userId)
  return { owner, key: contentOwnerKey(owner) }
}
