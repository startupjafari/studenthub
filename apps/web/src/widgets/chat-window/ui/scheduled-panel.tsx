'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Clock, Trash2 } from 'lucide-react'
import {
  cancelScheduledRequest,
  chatKeys,
  fetchScheduled,
  type ScheduledMessage,
} from '../../../entities/chat'
import { EmptyState, Modal, Skeleton } from '../../../shared/ui'

function whenText(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Мои отложенные сообщения этого чата: посмотреть и отменить.
 *
 * Чужие сюда не приходят и приходить не должны — до отправки это черновик автора,
 * а не сообщение чата.
 */
export function ScheduledPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: chatKeys.scheduled(chatId),
    queryFn: () => fetchScheduled(chatId),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => cancelScheduledRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.scheduled(chatId) })
      toast.success(t('scheduleCancelled'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const rows: ScheduledMessage[] = list.data ?? []

  return (
    <Modal onClose={onClose} title={t('scheduledTitle')} size="md">
      <div className="flex flex-col gap-2">
        {list.isPending ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
        ) : rows.length === 0 ? (
          <EmptyState icon={<Clock className="size-6" aria-hidden />} title={t('scheduledEmpty')} />
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2">{r.content}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('scheduledAt', { when: whenText(r.scheduledAt, locale) })}
                </p>
              </div>
              <button
                type="button"
                aria-label={t('scheduleCancel')}
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(r.id)}
                className="shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
