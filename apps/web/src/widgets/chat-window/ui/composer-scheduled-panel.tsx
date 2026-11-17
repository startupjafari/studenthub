'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BellOff, CalendarClock, Send, Trash2 } from 'lucide-react'
import {
  cancelScheduledRequest,
  composerKeys,
  fetchScheduledMessages,
  sendScheduledNowRequest,
} from '../../../entities/chat'
import { Button, EmptyState, Modal, Skeleton } from '../../../shared/ui'
import { plainPreview } from '../lib/format'

function whenText(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Мои отложенные сообщения этого чата: посмотреть, отправить сейчас или отменить. Открывается
 * значком часов в поле ввода — он виден, только пока отложенные есть (как в Telegram).
 * Чужие отложенные сюда не приходят: до отправки это черновик автора, а не сообщение чата.
 */
export function ComposerScheduledPanel({
  chatId,
  onClose,
}: {
  chatId: string
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: composerKeys.scheduled(chatId),
    queryFn: () => fetchScheduledMessages(chatId),
  })

  const onError = (e: unknown): void => {
    toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  }

  const cancel = useMutation({
    mutationFn: (id: string) => cancelScheduledRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: composerKeys.scheduled(chatId) })
      toast.success(t('tgComposer.scheduledCancelled'))
    },
    onError,
  })

  const sendNow = useMutation({
    mutationFn: (id: string) => sendScheduledNowRequest(id),
    // Само сообщение приедет в ленту событием message:new — как у доставки по времени.
    onSuccess: () => void qc.invalidateQueries({ queryKey: composerKeys.scheduled(chatId) }),
    onError,
  })

  const busy = cancel.isPending || sendNow.isPending

  return (
    <Modal onClose={onClose} title={t('tgComposer.scheduledTitle')} size="md">
      <div className="flex flex-col gap-2">
        {list.isPending ? (
          [0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
        ) : list.isError ? (
          <EmptyState
            icon={<CalendarClock className="size-8" aria-hidden />}
            title={t('tgComposer.scheduledLoadError')}
            action={
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                {t('tgComposer.retry')}
              </Button>
            }
          />
        ) : list.data.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-8" aria-hidden />}
            title={t('tgComposer.scheduledEmpty')}
          />
        ) : (
          list.data.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-xl p-3 text-sm ring-1 ring-foreground/10"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words">{plainPreview(r.content)}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  {r.silent && <BellOff className="size-3 shrink-0" aria-hidden />}
                  {t('tgComposer.scheduledAt', { when: whenText(r.scheduledAt, locale) })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={t('tgComposer.scheduledSendNow')}
                title={t('tgComposer.scheduledSendNow')}
                disabled={busy}
                onClick={() => sendNow.mutate(r.id)}
              >
                <Send aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={t('tgComposer.scheduledCancel')}
                title={t('tgComposer.scheduledCancel')}
                disabled={busy}
                onClick={() => cancel.mutate(r.id)}
                className="hover:text-destructive"
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
