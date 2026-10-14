'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Paperclip, Send } from 'lucide-react'
import {
  SUPPORT_TAGS,
  SupportReplySchema,
  type SupportReplyInput,
  type SupportTag,
} from '@studenthub/shared-schemas'
import {
  assignSupportRequest,
  closeSupportRequest,
  escalateSupportRequest,
  fetchSupportThread,
  mergeSupportRequest,
  replySupportRequest,
  setSupportTagsRequest,
  supportKeys,
} from '../../../entities/support-ticket'
import { ProfileLink } from '../../../entities/user'
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Skeleton,
  Textarea,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { useAppSelector } from '../../../shared/store'
import { tagLabels } from './tag-label'

// Тегов у обращения не больше трёх: набор, означающий всё, не означает ничего (сервер так же).
const MAX_TAGS = 3

interface SupportThreadModalProps {
  ticketId: string
  onClose: () => void
  /** Открыть другое обращение — после склейки в него. */
  onOpen: (id: string) => void
}

/**
 * Обращение целиком: переписка, ответ, «взять себе», теги, склейка с соседним обращением
 * того же человека, эскалация администраторам и закрытие. То же, что в мини-аппе, кроме
 * голосового ответа: с компьютера отвечают текстом.
 */
export function SupportThreadModal({ ticketId, onClose, onOpen }: SupportThreadModalProps) {
  const t = useTranslations('SupportDesk')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const labels = tagLabels(t)
  const [mergeInto, setMergeInto] = useState<string | null>(null)

  const thread = useQuery({
    queryKey: supportKeys.thread(ticketId),
    queryFn: () => fetchSupportThread(ticketId),
  })
  const data = thread.data
  const ticket = data?.ticket

  const refresh = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: supportKeys.all })
  }
  const onError = (e: unknown) => {
    const code = toApiError(e).code
    toast.error(code === 'CONFLICT' ? t('takenByOther') : tErr(code))
  }

  const form = useForm<SupportReplyInput>({ resolver: zodResolver(SupportReplySchema) })
  const reply = useMutation({
    mutationFn: (values: SupportReplyInput) => replySupportRequest(ticketId, values.text),
    onSuccess: async () => {
      form.reset({ text: '' })
      await refresh()
    },
    onError,
  })
  const assign = useMutation({
    mutationFn: (take: boolean) => assignSupportRequest(ticketId, take),
    onSuccess: refresh,
    onError,
  })
  const tags = useMutation({
    mutationFn: (next: SupportTag[]) => setSupportTagsRequest(ticketId, next),
    onSuccess: refresh,
    onError,
  })
  const escalate = useMutation({
    mutationFn: () => escalateSupportRequest(ticketId),
    onSuccess: () => toast.success(t('escalated')),
    onError,
  })
  const close = useMutation({
    mutationFn: () => closeSupportRequest(ticketId),
    onSuccess: async () => {
      toast.success(t('closed'))
      await refresh()
      onClose()
    },
    onError,
  })
  const merge = useMutation({
    mutationFn: (intoId: string) => mergeSupportRequest(ticketId, intoId),
    onSuccess: async (_, intoId) => {
      toast.success(t('merged'))
      await refresh()
      onOpen(intoId)
    },
    onError,
  })

  const author = ticket?.author
  const title = author ? `${author.lastName} ${author.firstName}` : t('deletedAuthor')
  const mine = ticket?.assigneeId === myId
  const takenByOther = !!ticket?.assigneeId && !mine
  const closedTicket = !!ticket?.closedAt
  // Сервер отдаёт свежие сверху; читается переписка сверху вниз.
  const messages = [...(data?.messages ?? [])].reverse()

  function toggleTag(tag: SupportTag): void {
    if (!ticket) return
    const has = ticket.tags.includes(tag)
    if (!has && ticket.tags.length >= MAX_TAGS) {
      toast.error(t('tagsLimit'))
      return
    }
    tags.mutate(has ? ticket.tags.filter((x) => x !== tag) : [...ticket.tags, tag])
  }

  return (
    <Modal onClose={onClose} title={title} size="2xl" height="stable">
      {thread.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : thread.isError || !data || !ticket ? (
        <EmptyState title={tErr(toApiError(thread.error).code)} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={closedTicket ? 'secondary' : 'info'}>
              {closedTicket ? t('statusClosed') : t('statusOpen')}
            </Badge>
            {author && (
              <ProfileLink userId={author.id} className="text-primary hover:underline">
                {t('openProfile')}
              </ProfileLink>
            )}
            <span className="text-muted-foreground">
              {ticket.assignee
                ? t('handledBy', {
                    name: `${ticket.assignee.lastName} ${ticket.assignee.firstName}`,
                  })
                : t('free')}
            </span>
            {data.mergedCount > 0 && (
              <span className="text-muted-foreground">
                {t('mergedCount', { count: data.mergedCount })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('tags')}>
            {SUPPORT_TAGS.map((tag) => {
              const active = ticket.tags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={active}
                  disabled={tags.isPending}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-ring/50',
                  )}
                >
                  {labels[tag]}
                </button>
              )
            })}
          </div>

          <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-border p-3">
            {messages.map((m) => {
              const fromAuthor = m.sender.id === author?.id
              return (
                <li
                  key={m.id}
                  className={cn(
                    'flex max-w-[85%] flex-col gap-0.5 rounded-xl px-3 py-2 text-sm',
                    fromAuthor ? 'self-start bg-muted' : 'self-end bg-primary/10',
                  )}
                >
                  <span className="text-xs text-muted-foreground">
                    {m.sender.lastName} {m.sender.firstName} ·{' '}
                    {new Date(m.createdAt).toLocaleString(locale, {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {m.content && <p className="whitespace-pre-line">{m.content}</p>}
                  {/* Вложения скачиваются в чате автора; здесь важно знать, что они есть. */}
                  {(m.media?.length ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip className="size-3" aria-hidden />
                      {t('attachments', { count: m.media?.length ?? 0 })}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>

          {takenByOther ? (
            <p className="text-sm text-muted-foreground">{t('takenByOtherHint')}</p>
          ) : (
            <form
              onSubmit={form.handleSubmit((values) => reply.mutate(values))}
              className="flex items-end gap-2"
            >
              <Textarea
                rows={2}
                className="flex-1"
                placeholder={closedTicket ? t('replyReopens') : t('replyPlaceholder')}
                aria-label={t('replyPlaceholder')}
                aria-invalid={!!form.formState.errors.text}
                {...form.register('text')}
              />
              <Button type="submit" icon aria-label={t('send')} loading={reply.isPending}>
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap gap-2">
              {!ticket.assigneeId && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={assign.isPending}
                  onClick={() => assign.mutate(true)}
                >
                  {t('take')}
                </Button>
              )}
              {mine && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={assign.isPending}
                  onClick={() => assign.mutate(false)}
                >
                  {t('release')}
                </Button>
              )}
              {data.siblings.length > 0 && (
                <span className="flex items-center gap-1">
                  <select
                    aria-label={t('mergeWith')}
                    value={mergeInto ?? ''}
                    onChange={(e) => setMergeInto(e.target.value || null)}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">{t('mergeWith')}</option>
                    {data.siblings.map((s) => (
                      <option key={s.id} value={s.id}>
                        {new Date(s.createdAt).toLocaleDateString(locale)}
                        {s.closed ? ` · ${t('statusClosed')}` : ''}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!mergeInto}
                    loading={merge.isPending}
                    onClick={() => mergeInto && merge.mutate(mergeInto)}
                  >
                    {t('merge')}
                  </Button>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                loading={escalate.isPending}
                onClick={async () => {
                  if (await confirm({ title: t('confirmEscalate') })) escalate.mutate()
                }}
              >
                {t('escalate')}
              </Button>
              {!closedTicket && !takenByOther && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={close.isPending}
                  onClick={async () => {
                    if (await confirm({ title: t('confirmClose') })) close.mutate()
                  }}
                >
                  {t('close')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
