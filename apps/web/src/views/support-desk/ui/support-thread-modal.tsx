'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Flag, GitMerge, Pencil, ShieldAlert, Undo2 } from 'lucide-react'
import { SUPPORT_TAGS, type SupportTag } from '@studenthub/shared-schemas'
import {
  assignSupportRequest,
  closeSupportRequest,
  escalateSupportRequest,
  fetchSupportEarlierMessages,
  fetchSupportThread,
  mergeSupportRequest,
  setSupportTagsRequest,
  supportKeys,
  type SupportMessage,
} from '../../../entities/support-ticket'
import { ProfileLink, UserPicker, type PickedUser } from '../../../entities/user'
import { complaintKeys, createComplaintFromSupportRequest } from '../../../entities/complaint'
import { toggleReactionRequest } from '../../../entities/chat'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Modal,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { tagLabels } from './tag-label'
import { SupportBubble, SupportComposer } from './support-thread-parts'

// Тегов у обращения не больше трёх: набор, означающий всё, не означает ничего (сервер так же).
const MAX_TAGS = 3

interface SupportThreadModalProps {
  ticketId: string
  onClose: () => void
  /** Открыть другое обращение — после склейки в него. */
  onOpen: (id: string) => void
}

/**
 * Обращение целиком: переписка как в чате (вложения, голосовые, ответы, реакции), «взять
 * себе», темы, склейка с соседним обращением того же человека, эскалация администраторам и
 * закрытие.
 */
export function SupportThreadModal({ ticketId, onClose, onOpen }: SupportThreadModalProps) {
  const t = useTranslations('SupportDesk')
  const tErr = useTranslations('Errors')
  const tRoles = useTranslations('Roles')
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

  // Ответ на конкретное сообщение — как в чате. Привязан к обращению: после склейки окно
  // открывает другое, и цитата отсюда там не нужна.
  const [replyTo, setReplyTo] = useState<{ ticketId: string; message: SupportMessage } | null>(null)
  // Реакции — чатовой ручкой: сотрудник участник обращения, право то же, что в чате.
  const react = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      toggleReactionRequest(messageId, emoji),
    onSuccess: refresh,
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

  function jumpTo(messageId: string): void {
    const el = document.getElementById(`support-msg-${messageId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Подсветка, чтобы глаз нашёл оригинал среди соседей, — как переход к цитате в чате.
    el.dataset.flash = 'true'
    window.setTimeout(() => delete el.dataset.flash, 1200)
  }

  const dayOf = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  const timeOf = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  return (
    <Modal onClose={onClose} title={title} size="3xl" height="tall">
      {thread.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : thread.isError || !data || !ticket ? (
        <EmptyState title={tErr(toApiError(thread.error).code)} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Сводка: что за обращение и кто за него отвечает. Подписанные пары вместо строки
              без разделителей — «Профиль автора» и «Разбирает» читались одним предложением. */}
          <section className="flex flex-col gap-3 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
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
              </div>
              {/* Кто пишет: аватар, роль и вуз — студенту и админу вуза отвечают по-разному.
                  Карточка целиком ведёт в профиль. */}
              {author && (
                <ProfileLink
                  userId={author.id}
                  title={t('openProfile')}
                  className="flex min-w-0 items-center gap-2.5 rounded-lg p-1 pr-2 transition-colors hover:bg-muted"
                >
                  <Avatar className="size-9">
                    {author.avatarThumbUrl && <AvatarImage src={author.avatarThumbUrl} alt="" />}
                    <AvatarFallback className="text-xs">
                      {`${author.firstName[0] ?? ''}${author.lastName[0] ?? ''}`.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {author.lastName} {author.firstName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[author.role ? tRoles(author.role) : null, author.university]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
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

              {/* Темы ставит команда, а не автор — он пишет только текст. По ним работают
                  фильтр очереди и сводка «о чём спрашивают». Поэтому показываем выбранные, а
                  правка — отдельным действием, а не палитрой всех семи переключателей. */}
              <dt className="text-xs text-muted-foreground">{t('topic')}</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {ticket.tags.length === 0 ? (
                  <span className="text-sm text-muted-foreground">{t('topicNone')}</span>
                ) : (
                  ticket.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {labels[tag]}
                    </Badge>
                  ))
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      disabled={tags.isPending}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      {ticket.tags.length === 0 ? t('setTopic') : t('editTopics')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {t('topicsHint')}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {SUPPORT_TAGS.map((tag) => (
                      <DropdownMenuCheckboxItem
                        key={tag}
                        checked={ticket.tags.includes(tag)}
                        // Меню не закрываем: темы выбирают по одной, до трёх.
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() => toggleTag(tag)}
                      >
                        {labels[tag]}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
                  <SupportBubble
                    message={m}
                    fromAuthor={fromAuthor}
                    firstOfRun={firstOfRun}
                    myId={myId}
                    time={timeOf(m.createdAt)}
                    onReply={() => setReplyTo({ ticketId, message: m })}
                    onReact={(emoji) => react.mutate({ messageId: m.id, emoji })}
                    onJumpTo={jumpTo}
                  />
                </li>
              )
            })}
          </ol>

          {takenByOther ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              {t('takenByOtherHint')}
            </p>
          ) : (
            <SupportComposer
              ticketId={ticketId}
              closedTicket={closedTicket}
              replyTo={replyTo?.ticketId === ticketId ? replyTo.message : null}
              onCancelReply={() => setReplyTo(null)}
              onSent={() => {
                setReplyTo(null)
                void refresh()
              }}
            />
          )}

          {/* Подвал: слева «Закрыть обращение», справа остальные действия по нему. Окно
              закрывается крестиком в шапке — отдельная «Закрыть» путалась с закрытием
              обращения. */}
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            {!closedTicket && !takenByOther && (
              <Button
                className="mr-auto"
                variant={ticket.assigneeId ? 'default' : 'outline'}
                loading={close.isPending}
                onClick={async () => {
                  if (await confirm({ title: t('confirmClose') })) close.mutate()
                }}
              >
                {t('close')}
              </Button>
            )}

            {/* Склейка — только когда у автора есть другие обращения: её цель надо выбрать. */}
            {data.siblings.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={merge.isPending}>
                    <GitMerge className="size-4" aria-hidden />
                    {t('merge')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-64">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {t('mergeWith')}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {data.siblings.map((sibling) => (
                    <DropdownMenuItem
                      key={sibling.id}
                      onSelect={async () => {
                        if (await confirm({ title: t('confirmMerge') })) merge.mutate(sibling.id)
                      }}
                    >
                      {new Date(sibling.createdAt).toLocaleDateString(locale)}
                      {sibling.closed ? ` · ${t('statusClosed')}` : ''}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="outline"
              loading={escalate.isPending}
              onClick={async () => {
                if (await confirm({ title: t('confirmEscalate') })) escalate.mutate()
              }}
            >
              <ShieldAlert className="size-4" aria-hidden />
              {t('escalate')}
            </Button>
            {author && (
              <Button variant="outline" onClick={() => setComplaintOpen(true)}>
                <Flag className="size-4" aria-hidden />
                {t('fileComplaint')}
              </Button>
            )}
            {mine && (
              <Button
                variant="outline"
                loading={assign.isPending}
                onClick={() => assign.mutate(false)}
              >
                <Undo2 className="size-4" aria-hidden />
                {t('release')}
              </Button>
            )}
            {!ticket.assigneeId && (
              <Button loading={assign.isPending} onClick={() => assign.mutate(true)}>
                {t('take')}
              </Button>
            )}
          </footer>
        </div>
      )}
      {/* Жалоба — отдельным окном поверх обращения: встроенная панель сжимала переписку и
          смешивала свои кнопки с подвалом обращения. */}
      {complaintOpen && (
        <Modal
          onClose={() => {
            setComplaintOpen(false)
            setComplaintTarget(null)
          }}
          title={t('fileComplaint')}
          size="lg"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('complaintHint')}</p>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('complaintTarget')}</span>
              <UserPicker
                inline
                value={complaintTarget}
                onSelect={setComplaintTarget}
                placeholder={t('complaintTargetPlaceholder')}
              />
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border pt-4">
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
            </footer>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
