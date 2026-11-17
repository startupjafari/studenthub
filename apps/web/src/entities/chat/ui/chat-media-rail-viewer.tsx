'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { chatKeys } from '../api/chat-api'
import { useChatMediaRail } from '../lib/use-chat-media-rail'
import type { ChatMediaItem, ChatMessage, MessageAttachment } from '../model/types'
import { MediaViewer, type MediaViewerActions, type MediaViewerMeta } from './media-viewer'

/**
 * Действия над сообщением кадра. Набор — тот же, что у пузыря (MessageActions окна чата):
 * чего нет, того нет и в просмотрщике (из правой панели — только «перейти к сообщению»).
 */
export interface ChatMediaRailActions {
  focus: (messageId: string) => void
  copy?: (m: ChatMessage) => void
  forward?: (m: ChatMessage) => void
  del?: (m: ChatMessage) => void
  copiedImage?: (ok: boolean) => void
}

/** Чат, по медиа которого листает просмотрщик, и что можно делать с их сообщениями. */
export interface ChatMediaRailContext {
  chatId: string
  myId?: string
  actions: ChatMediaRailActions
}

/** Кадр, с которого открыли, — до приезда ленты чата. */
export interface ChatMediaRailStart {
  /** Кадры, с которых открыли, по времени: вложения сообщения или загруженная сетка вкладки. */
  items: ChatMediaItem[]
  /** Вложения тех же кадров (оптимистичная `localUrl` после отправки, размеры). */
  attachments?: MessageAttachment[]
  index: number
  /** Сообщение, из пузыря которого открыли: его подпись и действия уже готовы у пузыря. */
  messageId?: string
  meta?: MediaViewerMeta
  actions?: MediaViewerActions
}

function toAttachment(it: ChatMediaItem): MessageAttachment {
  return {
    id: it.id,
    mime: it.mime,
    size: it.size,
    name: it.name,
    width: it.width,
    height: it.height,
    placeholder: it.placeholder,
    durationMs: it.durationMs,
  }
}

/** «Фамилия Имя» — тем же видом, что в шапке пузыря. */
function nameOf(sender: { firstName: string; lastName: string } | null | undefined): string {
  return sender ? `${sender.lastName} ${sender.firstName}`.trim() : ''
}

/**
 * Просмотрщик, листающий ВСЕ фото и видео чата подряд (как в Telegram), а не только вложения
 * одного сообщения: соседние страницы подгружаются у края, счётчик «N из M» — по всему чату,
 * шапка ведёт к сообщению кадра.
 *
 * Открывается мгновенно на том, с чего открыли (`start`), и незаметно переходит на ленту чата,
 * когда та приехала, — текущий кадр держится по id, а не по индексу: подгрузка старых слева
 * сдвигает индексы. Не приехала (сбой сети, кадр не из медиа чата) — листаются кадры `start`.
 */
export function ChatMediaRailViewer({
  rail,
  start: startProp,
  originOf,
  onClose,
}: {
  rail: ChatMediaRailContext
  start: ChatMediaRailStart
  /** Миниатюра кадра на экране (пузырь, плитка сетки) — для полёта при открытии и закрытии. */
  originOf?: (fileId: string) => HTMLElement | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  // Снимок на момент открытия: пузырь перерисовывается (реакции, правка), и новый объект на
  // каждый его рендер пересобирал бы ленту и заново грел соседние кадры. Подпись и действия
  // своего сообщения берём свежими — их пузырь знает лучше.
  const [frozen] = useState(startProp)
  const start = { ...frozen, meta: startProp.meta, actions: startProp.actions }
  const anchor = frozen.items[frozen.index] ?? null
  const [currentId, setCurrentId] = useState<string | null>(anchor?.id ?? null)
  const chatRail = useChatMediaRail(rail.chatId, anchor)

  // Лента чата годится, только если в ней есть текущий кадр (иначе — кадры открытия).
  const railItems = chatRail.items
  const onRail = !!railItems && railItems.some((it) => it.id === currentId)
  const list = onRail ? (railItems as ChatMediaItem[]) : start.items
  const found = list.findIndex((it) => it.id === currentId)
  const index = found >= 0 ? found : 0
  const cur = list[index]

  const { reach } = chatRail
  useEffect(() => {
    if (onRail) reach(index)
  }, [onRail, index, reach])

  // Вложения для просмотрщика: у кадров самого сообщения — его вложения (там бывает
  // `localUrl` только что отправленного), у остальных — из выдачи материалов.
  const attachments = useMemo(() => {
    const own = new Map((start.attachments ?? []).map((a) => [a.id, a]))
    return list.map((it) => own.get(it.id) ?? toAttachment(it))
  }, [list, start.attachments])

  if (!cur) return null

  const ownMessage = !!start.messageId && cur.messageId === start.messageId
  let meta: MediaViewerMeta | undefined
  let actions: MediaViewerActions | undefined
  if (ownMessage && start.meta) {
    meta = start.meta
    actions = start.actions
  } else {
    // Сообщение кадра из загруженной истории — подпись, «переслать», «удалить» как у пузыря.
    // Вне истории — то, что знает выдача материалов, и «перейти к сообщению».
    const message = qc
      .getQueryData<ChatMessage[]>(chatKeys.messages(rail.chatId))
      ?.find((m) => m.id === cur.messageId)
    const sender = message?.sender ?? cur.sender
    const senderId = message?.senderId ?? cur.sender?.id
    meta = {
      senderName: nameOf(sender),
      senderAvatarUrl: sender?.avatarUrl ?? null,
      createdAt: message?.createdAt ?? cur.createdAt,
      mine: !!rail.myId && senderId === rail.myId,
      caption: (message ? message.content : cur.caption) || undefined,
    }
    const a = rail.actions
    actions = {
      onGoTo: () => a.focus(cur.messageId),
      onCopy: message && a.copy ? () => a.copy?.(message) : undefined,
      onCopiedImage: a.copiedImage,
      onForward: message && a.forward ? () => a.forward?.(message) : undefined,
      onDelete: message && a.del ? () => a.del?.(message) : undefined,
    }
  }

  return (
    <MediaViewer
      items={attachments}
      index={index}
      itemKey={cur.id}
      onIndexChange={(i) => {
        const next = list[i]
        if (next) setCurrentId(next.id)
      }}
      onClose={onClose}
      meta={meta}
      actions={actions}
      counter={onRail ? { current: chatRail.first + index, total: chatRail.total } : undefined}
      getOrigin={(i) => {
        const id = list[i]?.id
        return id && originOf ? originOf(id) : null
      }}
    />
  )
}
