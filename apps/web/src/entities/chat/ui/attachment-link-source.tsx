'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { MediaLink } from '../../../shared/api'
import { fetchAttachmentLink } from '../api/chat-api'

/**
 * Откуда брать ссылку на вложение. Вложения и просмотрщик чата рисуют не только сообщения:
 * тем же видом показываются вложения обсуждения события, а их ссылки выдаёт свой эндпоинт
 * со своей проверкой доступа. Без провайдера — чат, как и было.
 */
export interface AttachmentLinkSource {
  /** Начало ключа кэша: ссылки разных владельцев не должны пересекаться. */
  scope: string
  fetch: (fileId: string) => Promise<MediaLink>
}

const CHAT_SOURCE: AttachmentLinkSource = { scope: 'chat-attachment', fetch: fetchAttachmentLink }

const AttachmentLinkContext = createContext<AttachmentLinkSource>(CHAT_SOURCE)

export function AttachmentLinkProvider({
  source,
  children,
}: {
  source: AttachmentLinkSource
  children: ReactNode
}) {
  return <AttachmentLinkContext.Provider value={source}>{children}</AttachmentLinkContext.Provider>
}

export function useAttachmentLinkSource(): AttachmentLinkSource {
  return useContext(AttachmentLinkContext)
}
