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

/**
 * Пора ли грузить медиа этой строки. Лента без виртуализации держит в DOM сотни сообщений,
 * и если каждое вложение сразу просит ссылку, быстрая прокрутка истории съедает лимит
 * запросов API (каждая ссылка — отдельный запрос). Как в Telegram, медиа грузится, только
 * когда строка подъехала к кадру и задержалась там; пролетевшее мимо не запрашивается.
 * Окно ленты выставляет флаг на каждую строку; вне ленты (просмотрщик, обсуждения) — сразу.
 */
const MediaNearContext = createContext(true)

export function MediaNearProvider({ near, children }: { near: boolean; children: ReactNode }) {
  return <MediaNearContext.Provider value={near}>{children}</MediaNearContext.Provider>
}

export function useMediaNear(): boolean {
  return useContext(MediaNearContext)
}
