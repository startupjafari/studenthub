'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Flag, GitMerge, MoreHorizontal, Send, ShieldAlert, Undo2, UserRound } from 'lucide-react'
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
  fetchSupportEarlierMessages,
  fetchSupportThread,
  mergeSupportRequest,
  replySupportRequest,
  setSupportTagsRequest,
  supportKeys,
  type SupportMessage,
} from '../../../entities/support-ticket'
import { ProfileLink, UserPicker, type PickedUser } from '../../../entities/user'
import { complaintKeys, createComplaintFromSupportRequest } from '../../../entities/complaint'
import { MessageAttachments } from '../../../entities/chat'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  // Жалоба из обращения: люди жалуются на других через поддержку, и передать это модерации
  // в вебе было нечем — только из мини-аппа. null — панель закрыта.
  const [complaintTarget, setComplaintTarget] = useState<PickedUser | null>(null)
  const [complaintOpen, setComplaintOpen] = useState(false)
  // Дочитанная история длинного обращения (сервер отдаёт последние 50). Привязана к
  // обращению: после склейки окно открывает другое, и чужая история здесь не нужна.
  const [earlier, setEarlier] = useState<{
    ticketId: string
    items: SupportMessage[]
    cursor: string | null
  } | null>(null)

  const thread = useQuery({
    queryKey: supportKeys.thread(ticketId),
    queryFn: () => fetchSupportThread(ticketId),
  })
  const data = thread.data
  const ticket = data?.ticket

  const refresh = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: supportKeys.all })
  }
  // CONFLICT значит разное: у «взять» — обращение уже за другим, у склейки — ветка уже
  // склеена. Общий перевод «разбирает другой» на любой CONFLICT врал про склейку.
  const onError = (e: unknown) => toast.error(tErr(toApiError(e).code))
  const conflictError = (conflictText: string) => (e: unknown) => {
    const code = toApiError(e).code
    toast.error(code === 'CONFLICT' ? conflictText : tErr(code))
  }
  const loadEarlier = useMutation({
    mutationFn: (cursor: string) => fetchSupportEarlierMessages(ticketId, cursor),
    onSuccess: (page) =>
      setEarlier((prev) => ({
        ticketId,
        items: [...(prev?.ticketId === ticketId ? prev.items : []), ...page.items],
        cursor: page.cursor,
      })),
    onError: (e: unknown) => toast.error(tErr(toApiError(e).code)),
  })

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
    onError: conflictError(t('takenByOther')),
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
  const fileComplaint = useMutation({
    mutationFn: (target: PickedUser) =>
      createComplaintFromSupportRequest({ chatId: ticketId, targetId: target.id }),
    onSuccess: async () => {
      toast.success(t('complaintCreated'))
      setComplaintOpen(false)
      setComplaintTarget(null)
      await qc.invalidateQueries({ queryKey: complaintKeys.all })
    },
    onError: (e: unknown) => {
      const code = toApiError(e).code
      toast.error(code === 'CONFLICT' ? t('complaintDuplicate') : tErr(code))
    },
  })
  const merge = useMutation({
    mutationFn: (intoId: string) => mergeSupportRequest(ticketId, intoId),
    onSuccess: async (_, intoId) => {
      toast.success(t('merged'))
      await refresh()
      onOpen(intoId)
    },
    onError: conflictError(t('mergeConflict')),
  })

  const author = ticket?.author
  const title = author ? `${author.lastName} ${author.firstName}` : t('deletedAuthor')
  const mine = ticket?.assigneeId === myId
  const takenByOther = !!ticket?.assigneeId && !mine
  const closedTicket = !!ticket?.closedAt
  const ownEarlier = earlier?.ticketId === ticketId ? earlier : null
  const earlierCursor = ownEarlier ? ownEarlier.cursor : (data?.earlierCursor ?? null)
  // Сервер отдаёт свежие сверху; читается переписка сверху вниз. Склеенные ветки идут
  // вперемешку по времени — поэтому общий порядок, а не просто дописка в начало.
  const messages = [
    ...new Map(
      [...(data?.messages ?? []), ...(ownEarlier?.items ?? [])].map((m) => [m.id, m]),
    ).values(),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  function toggleTag(tag: SupportTag): void {
    if (!ticket) return
    const has = ticket.tags.includes(tag)
    if (!has && ticket.tags.length >= MAX_TAGS) {
      toast.error(t('tagsLimit'))
      return
    }
    tags.mutate(has ? ticket.tags.filter((x) => x !== tag) : [...ticket.tags, tag])
  }

  // Переписка прокручивается к свежему сообщению: обращение открывают, чтобы ответить на него.
  // Догрузка ранних самое свежее не меняет — читатель остаётся там, где был.
  const listRef = useRef<HTMLOListElement>(null)
  const newestId = messages.at(-1)?.id
  useEffect(() => {
    const list = listRef.current
    if (list && newestId) list.scrollTop = list.scrollHeight
  }, [newestId])

  const dayOf = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  const timeOf = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  return (
    <Modal onClose={onClose} title={title} size="2xl" height="stable">
      {thread.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : thread.isError || !data || !ticket ? (
        <EmptyState title={tErr(toApiError(thread.error).code)} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Сводка: что за обращение и кто за него отвечает. Подписанные пары вместо строки
              без разделителей — «Профиль автора» и «Разбирает» читались одним предложением. */}
          <section className="flex flex-col gap-3 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={closedTicket ? 'secondary' : 'info'}>
                {closedTicket ? t('statusClosed') : t('statusOpen')}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t('createdAt', {
                  date: new Date(ticket.createdAt).toLocaleString(locale, {
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </span>
              {data.mergedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  · {t('mergedCount', { count: data.mergedCount })}
                </span>
              )}
              {author && (
                <ProfileLink
                  userId={author.id}
                  className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <UserRound className="size-3.5" aria-hidden />
                  {t('openProfile')}
                </ProfileLink>
              )}
            </div>

            <dl className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-6">
              <dt className="text-xs text-muted-foreground">{t('colAssignee')}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-sm">
                {ticket.assignee ? (
                  <span className="font-medium">
                    {ticket.assignee.lastName} {ticket.assignee.firstName}
                    {mine && (
                      <span className="font-normal text-muted-foreground"> · {t('you')}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('nobody')}</span>
                )}
              </dd>

              <dt className="text-xs text-muted-foreground">{t('topic')}</dt>
              <dd className="flex flex-wrap gap-1.5" role="group" aria-label={t('tags')}>
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
                        'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-ring/50 hover:text-foreground',
                      )}
                    >
                      {labels[tag]}
                    </button>
                  )
                })}
              </dd>
            </dl>
          </section>

          {/* Переписка как в чате: автор слева, команда справа, разделители по дням, имя —
              только у первого сообщения серии. */}
          <ol
            ref={listRef}
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-xl bg-muted/30 p-3"
          >
            {earlierCursor && (
              <li className="self-center pb-2">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  loading={loadEarlier.isPending}
                  onClick={() => loadEarlier.mutate(earlierCursor)}
                >
                  {t('showEarlier')}
                </Button>
              </li>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const day = dayOf(m.createdAt)
              const newDay = !prev || dayOf(prev.createdAt) !== day
              const firstOfRun = newDay || prev?.sender.id !== m.sender.id
              const fromAuthor = m.sender.id === author?.id
              return (
                <li key={m.id} className="contents">
                  {newDay && (
                    <span className="my-1.5 self-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
                      {day}
                    </span>
                  )}
                  <div
                    className={cn(
                      'flex max-w-[80%] flex-col gap-0.5',
                      fromAuthor ? 'items-start self-start' : 'items-end self-end',
                      firstOfRun && !newDay && 'mt-1.5',
                    )}
                  >
                    {firstOfRun && (
                      <span className="px-1 text-xs font-medium text-muted-foreground">
                        {m.sender.lastName} {m.sender.firstName}
                      </span>
                    )}
                    <div
                      className={cn(
                        'flex flex-col gap-1 rounded-2xl px-3 py-1.5 text-sm',
                        fromAuthor ? 'bg-muted' : 'bg-primary/15',
                      )}
                    >
                      {/* Вложения — тем же видом, что в чате: обращение и есть чат, а сотрудник
                          в нём участник, так что ссылки на файлы выдаёт обычная проверка
                          членства. Из «Чатов» обращения сотрудникам больше не попадают —
                          смотреть скриншоты больше негде, кроме как здесь. */}
                      {m.media && m.media.length > 0 && (
                        <MessageAttachments
                          media={m.media}
                          // Пузыри здесь светлые, а не сплошные синие, как свои в чате:
                          // подписи вложений нужны обычного цвета.
                          mine={false}
                          viewerMeta={{
                            senderName: `${m.sender.lastName} ${m.sender.firstName}`,
                            createdAt: m.createdAt,
                            mine: !fromAuthor,
                            caption: m.content ?? undefined,
                          }}
                        />
                      )}
                      {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                      <time
                        dateTime={m.createdAt}
                        className="self-end text-[11px] tabular-nums text-muted-foreground"
                      >
                        {timeOf(m.createdAt)}
                      </time>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          {takenByOther ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              {t('takenByOtherHint')}
            </p>
          ) : (
            <form
              onSubmit={form.handleSubmit((values) => reply.mutate(values))}
              className="flex flex-col gap-1.5"
            >
              {/* Закрытое обращение отвечать не мешает, но об этом говорим заранее, а не
                  подсказкой в пустом поле, которая пропадает с первой буквой. */}
              {closedTicket && <p className="text-xs text-muted-foreground">{t('replyReopens')}</p>}
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  className="field-sizing-content max-h-40 flex-1 resize-none"
                  placeholder={t('replyPlaceholder')}
                  aria-label={t('replyPlaceholder')}
                  aria-invalid={!!form.formState.errors.text}
                  onKeyDown={(e) => {
                    // Enter отправляет, Shift+Enter — перенос строки, как в чате.
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void form.handleSubmit((values) => reply.mutate(values))()
                    }
                  }}
                  {...form.register('text')}
                />
                <Button type="submit" icon aria-label={t('send')} loading={reply.isPending}>
                  <Send className="size-4" aria-hidden />
                </Button>
              </div>
            </form>
          )}

          {complaintOpen && (
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <span className="text-sm font-medium">{t('complaintTarget')}</span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <UserPicker
                    value={complaintTarget}
                    onSelect={setComplaintTarget}
                    placeholder={t('complaintTargetPlaceholder')}
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setComplaintOpen(false)
                    setComplaintTarget(null)
                  }}
                >
                  {t('cancel')}
                </Button>
                <Button
                  disabled={!complaintTarget}
                  loading={fileComplaint.isPending}
                  onClick={async () => {
                    if (!complaintTarget) return
                    const name = `${complaintTarget.lastName} ${complaintTarget.firstName}`
                    if (await confirm({ title: t('confirmComplaint', { name }) })) {
                      fileComplaint.mutate(complaintTarget)
                    }
                  }}
                >
                  {t('complaintSubmit')}
                </Button>
              </div>
            </div>
          )}

          {/* Подвал: слева редкие действия в меню «Ещё», справа — одно главное по ситуации:
              взять свободное обращение или закрыть своё. Раньше пять действий одного веса
              стояли в ряд, и «Позвать администратора» было в одном ряду с «Закрыть». */}
          <footer className="flex items-center gap-2 border-t border-border pt-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="mr-auto">
                  <MoreHorizontal className="size-4" aria-hidden />
                  {t('more')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-64">
                {mine && (
                  <DropdownMenuItem
                    disabled={assign.isPending}
                    onSelect={() => assign.mutate(false)}
                  >
                    <Undo2 className="size-4" aria-hidden />
                    {t('release')}
                  </DropdownMenuItem>
                )}
                {author && (
                  <DropdownMenuItem onSelect={() => setComplaintOpen(true)}>
                    <Flag className="size-4" aria-hidden />
                    {t('fileComplaint')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  disabled={escalate.isPending}
                  onSelect={async () => {
                    if (await confirm({ title: t('confirmEscalate') })) escalate.mutate()
                  }}
                >
                  <ShieldAlert className="size-4" aria-hidden />
                  {t('escalate')}
                </DropdownMenuItem>
                {/* Склейка — только когда у автора есть другие обращения. */}
                {data.siblings.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {t('mergeWith')}
                    </DropdownMenuLabel>
                    {data.siblings.map((sibling) => (
                      <DropdownMenuItem
                        key={sibling.id}
                        disabled={merge.isPending}
                        onSelect={async () => {
                          if (await confirm({ title: t('confirmMerge') })) merge.mutate(sibling.id)
                        }}
                      >
                        <GitMerge className="size-4" aria-hidden />
                        {new Date(sibling.createdAt).toLocaleDateString(locale)}
                        {sibling.closed ? ` · ${t('statusClosed')}` : ''}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {!ticket.assigneeId && (
              <Button loading={assign.isPending} onClick={() => assign.mutate(true)}>
                {t('take')}
              </Button>
            )}
            {!closedTicket && !takenByOther && (
              <Button
                variant={ticket.assigneeId ? 'default' : 'outline'}
                loading={close.isPending}
                onClick={async () => {
                  if (await confirm({ title: t('confirmClose') })) close.mutate()
                }}
              >
                {t('close')}
              </Button>
            )}
          </footer>
        </div>
      )}
    </Modal>
  )
}
