'use client'

import { useCallback, useState } from 'react'
import { forwardBatchRequest, type ChatMessage } from '../../../entities/chat'

/**
 * Пересылка, собранная над полем ввода целевого чата (Telegram: «Переслать» → выбор чата →
 * плашка «Пересланные сообщения» в нём). Сообщения уходят только по «Отправить» — вместе с
 * тем, что человек дописал в поле, — и до этого получателя можно сменить, имена и подписи
 * скрыть, а пересылку отменить.
 */
export interface ForwardDraft {
  /** Куда уйдёт пересылка: плашка видна только в этом чате. */
  chatId: string
  /** Снимок выбранных сообщений — по времени, как они и уйдут. */
  messages: ChatMessage[]
  hideSender: boolean
  hideCaptions: boolean
}

/** Есть ли что скрывать «скрыть подписи»: подпись — текст у сообщения с вложениями. */
export function hasForwardCaptions(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.media.length > 0 && m.content.trim().length > 0)
}

function chronological(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.seq - b.seq,
  )
}

export function forwardRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Запасной uuid v4 — схема требует именно uuid.
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

export interface ForwardDraftController {
  draft: ForwardDraft | null
  /** Пересылка этого чата — то, что рисует плашка над полем. */
  active: ForwardDraft | null
  sending: boolean
  start: (chatId: string, messages: ChatMessage[]) => void
  /** «Сменить получателя»: та же пересылка уходит в другой чат. */
  retarget: (chatId: string) => void
  toggleSender: () => void
  toggleCaptions: () => void
  cancel: () => void
  /** Отправить пересылку с комментарием из поля. `false` — не ушла, плашка осталась. */
  send: (opts: { comment: string; noLinkPreview?: boolean }) => Promise<boolean>
}

export function useForwardDraft({
  activeId,
  replyToId,
  editingId,
  onError,
}: {
  activeId: string | null
  replyToId: string | undefined
  editingId: string | undefined
  onError: (code: string) => void
}): ForwardDraftController {
  const [draft, setDraft] = useState<ForwardDraft | null>(null)
  const [sending, setSending] = useState(false)

  // Ответ или правка в чате с пересылкой её заменяют, как в Telegram: над полем одна
  // плашка, и непонятно было бы, к чему относится написанное. Сверяем с прошлым рендером,
  // а не эффектом: состояние меняется в том же проходе, без лишнего кадра с двумя плашками.
  const [seen, setSeen] = useState({ replyToId, editingId })
  if (seen.replyToId !== replyToId || seen.editingId !== editingId) {
    setSeen({ replyToId, editingId })
    const startedReply = !!replyToId && replyToId !== seen.replyToId
    const startedEdit = !!editingId && editingId !== seen.editingId
    if ((startedReply || startedEdit) && draft && draft.chatId === activeId) setDraft(null)
  }

  const start = useCallback((chatId: string, messages: ChatMessage[]) => {
    if (messages.length === 0) return
    setDraft({ chatId, messages: chronological(messages), hideSender: false, hideCaptions: false })
  }, [])

  const retarget = useCallback((chatId: string) => {
    setDraft((d) => (d ? { ...d, chatId } : d))
  }, [])

  // Подпись без имени автора — уже слова пересылающего, поэтому «скрыть подписи» скрывает
  // и имя, а «показать имя» возвращает и подписи (так же решает сервер и Telegram).
  const toggleSender = useCallback(() => {
    setDraft((d) =>
      d
        ? d.hideSender
          ? { ...d, hideSender: false, hideCaptions: false }
          : { ...d, hideSender: true }
        : d,
    )
  }, [])

  const toggleCaptions = useCallback(() => {
    setDraft((d) =>
      d
        ? d.hideCaptions
          ? { ...d, hideCaptions: false }
          : { ...d, hideCaptions: true, hideSender: true }
        : d,
    )
  }, [])

  const cancel = useCallback(() => setDraft(null), [])

  const send = useCallback(
    async ({ comment, noLinkPreview }: { comment: string; noLinkPreview?: boolean }) => {
      if (!draft || sending) return false
      setSending(true)
      try {
        const results = await forwardBatchRequest({
          messageIds: draft.messages.map((m) => m.id),
          chatIds: [draft.chatId],
          ...(comment ? { comment } : {}),
          requestId: forwardRequestId(),
          ...(draft.hideSender ? { hideSender: true } : {}),
          ...(draft.hideCaptions ? { hideCaptions: true } : {}),
          ...(comment && noLinkPreview ? { noLinkPreview: true } : {}),
        })
        const failed = results.find((r) => !r.ok)
        if (failed) {
          onError(failed.code ?? 'INTERNAL_ERROR')
          // Часть могла уйти до сбоя — повтор продублировал бы её; плашку снимаем.
          if (failed.messageIds.length > 0) setDraft(null)
          return failed.messageIds.length > 0
        }
        setDraft(null)
        return true
      } catch (e) {
        onError((e as { code?: string }).code ?? 'INTERNAL_ERROR')
        return false
      } finally {
        setSending(false)
      }
    },
    [draft, sending, onError],
  )

  return {
    draft,
    active: draft && draft.chatId === activeId ? draft : null,
    sending,
    start,
    retarget,
    toggleSender,
    toggleCaptions,
    cancel,
    send,
  }
}
