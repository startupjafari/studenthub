'use client'

import { useMemo, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { FileText, Link2, Loader2, Mic, Music, RotateCcw, Search, X } from 'lucide-react'
import type { MessageSearchKind } from '@studenthub/shared-schemas'
import {
  chatKeys,
  fetchTopPeers,
  searchMessages,
  type ChatListItem,
  type MessageAttachment,
} from '../../../entities/chat'
import type { DirectoryUser } from '../../../entities/user'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  ScrollRow,
} from '../../../shared/ui'
import { formatBytes, useByteUnitLabel } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { avatarColor, chatInitials, chatTitle, senderName } from '../lib/format'
import { chatListTime } from '../lib/list-time'
import { attachmentHits, formatClock, hostOf, linkHits, type SearchTab } from '../lib/global-search'
import { MessagePreview, PreviewThumb } from './chat-list-preview'

export { SEARCH_TABS, SEARCH_TAB_KEY, type SearchTab } from '../lib/global-search'

// Элемент результата поиска по сообщениям (подмножество ChatMessage + chatId).
export type MsgSearchItem = {
  id: string
  chatId: string
  content: string
  createdAt: string
  sender: { firstName: string; lastName: string }
}

/** Сколько «частых» собеседников в ряду над недавними. */
const TOP_PEERS = 12
const SECTION_TITLE =
  'px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'
const RESULT_ROW =
  'flex w-full cursor-pointer items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 lg:rounded-xl'

/** Пустая вкладка без запроса — что здесь появится (Telegram: «последние … из ваших чатов»). */
const EMPTY_KIND_KEY: Record<MessageSearchKind, string> = {
  media: 'tgSearch.emptyMedia',
  link: 'tgSearch.emptyLinks',
  file: 'tgSearch.emptyFiles',
  music: 'tgSearch.emptyMusic',
  voice: 'tgSearch.emptyVoice',
}

export type ChatListSearchProps = {
  tab: SearchTab
  /** Запрос после дебаунса; короче двух символов — пусто. */
  term: string
  activeId: string | null
  locale: string
  chats: ChatListItem[]
  chatById: Map<string, ChatListItem>
  chatMatches: ChatListItem[]
  msgMatches: MsgSearchItem[]
  msgResultsLoading: boolean
  peopleMatches: DirectoryUser[]
  peopleLoading: boolean
  startingPersonId: string | null
  onOpenPerson: (user: DirectoryUser) => void
  /** Открыть чат из выдачи — поиск при этом закрывается. */
  onPickChat: (chatId: string, opts?: { remember?: boolean }) => void
  /** Открыть чат сразу на найденном сообщении (прокрутить к нему и подсветить). */
  onPickMessage: (chatId: string, messageId: string) => void
  recentIds: string[]
  onClearRecent: () => void
  onRemoveRecent: (chatId: string) => void
}

/**
 * Глобальный поиск левой колонки: вкладки «Чаты · Медиа · Ссылки · Файлы · Музыка ·
 * Голосовые», как в Telegram.
 *
 * Пустой запрос во вкладке «Чаты» — не пустота, а «недавние»: ряд «Часто пишете» (рейтинг
 * считает сервер по моим сообщениям) и чаты, которые человек уже находил поиском. Во вкладках
 * материалов пустой запрос — последние материалы этого вида по всем моим чатам; с запросом
 * сервер ищет по подписи и по имени файла (ссылки — по адресу и заголовку превью). Выбор
 * строки открывает чат сразу на этом сообщении.
 */
export function ChatListSearch(props: ChatListSearchProps) {
  if (props.tab === 'chats') {
    return props.term.length >= 2 ? <ChatResults {...props} /> : <RecentView {...props} />
  }
  return <MessageKindResults {...props} kind={props.tab} />
}

function ChatAvatar({
  id,
  title,
  url,
  className,
}: {
  id: string
  title: string
  url: string | null
  className?: string
}) {
  return (
    <Avatar className={cn('size-10 shrink-0', className)}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className={cn('text-xs font-medium text-white', avatarColor(id))}>
        {chatInitials(title)}
      </AvatarFallback>
    </Avatar>
  )
}

type TopPeerView = {
  chatId: string
  title: string
  /** Подпись под аватаром — имя: «Фамилия Имя» в ряду не помещается. */
  short: string
  avatarUrl: string | null
  online: boolean
}

// ── Пустой запрос: «Часто пишете» и недавние ─────────────────────────────────
function RecentView({
  chats,
  chatById,
  recentIds,
  activeId,
  onPickChat,
  onClearRecent,
  onRemoveRecent,
}: ChatListSearchProps) {
  const t = useTranslations('Chats')
  const peers = useQuery({
    queryKey: chatKeys.topPeers(),
    queryFn: () => fetchTopPeers(TOP_PEERS),
    // Рейтинг меняется медленно — за время одного поиска пересчитывать незачем.
    staleTime: 5 * 60_000,
  })
  const top: TopPeerView[] = useMemo(() => {
    if (peers.data) {
      return peers.data.map((p) => ({
        chatId: p.chatId,
        title: `${p.user.lastName} ${p.user.firstName}`.trim(),
        short: p.user.firstName || p.user.lastName,
        avatarUrl: p.user.avatarUrl,
        online: chatById.get(p.chatId)?.online ?? false,
      }))
    }
    if (!peers.isError) return []
    // Сервер без «Часто пишете» (выкатывается позже веба) — честное приближение: личные чаты
    // с самой свежей перепиской.
    return chats
      .filter((c) => c.type === 'PRIVATE' && !c.archived && !c.requestIncoming && c.lastMessage)
      .sort(
        (a, b) =>
          new Date(b.lastMessage?.createdAt ?? 0).getTime() -
          new Date(a.lastMessage?.createdAt ?? 0).getTime(),
      )
      .slice(0, TOP_PEERS)
      .map((c) => {
        const title = chatTitle(c, t)
        return {
          chatId: c.id,
          title,
          short: title.split(' ').slice(-1)[0] ?? title,
          avatarUrl: c.avatarUrl,
          online: !!c.online,
        }
      })
  }, [peers.data, peers.isError, chats, chatById, t])
  // Недавние, которых уже нет в списке (вышел из группы, чат удалён), просто не показываем.
  const recent = recentIds.flatMap((id) => {
    const c = chatById.get(id)
    return c ? [c] : []
  })

  if (top.length === 0 && recent.length === 0) {
    if (peers.isLoading) return <Spinner />
    return (
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <EmptyState
          icon={<Search className="size-6" aria-hidden />}
          title={t('tgList.searchHintTitle')}
          description={t('tgList.searchHint')}
        />
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col">
      {top.length > 0 && (
        <section aria-label={t('tgSearch.topPeers')} className="border-b border-border pb-2">
          <p className={SECTION_TITLE}>{t('tgSearch.topPeers')}</p>
          <ScrollRow className="gap-1 px-1">
            {top.map((p) => (
              <button
                key={p.chatId}
                type="button"
                onClick={() => onPickChat(p.chatId, { remember: true })}
                aria-label={p.title}
                className="flex w-[4.5rem] shrink-0 cursor-pointer flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="relative">
                  <ChatAvatar
                    id={p.chatId}
                    title={p.title}
                    url={p.avatarUrl}
                    className="size-[3.375rem]"
                  />
                  {p.online && (
                    <span
                      className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-background bg-success"
                      aria-hidden
                    />
                  )}
                </span>
                <span className="w-full truncate text-center text-xs">{p.short}</span>
              </button>
            ))}
          </ScrollRow>
        </section>
      )}
      {recent.length > 0 && (
        <section aria-label={t('tgList.recent')}>
          <div className="flex items-center justify-between pr-2">
            <p className={SECTION_TITLE}>{t('tgList.recent')}</p>
            <button
              type="button"
              onClick={onClearRecent}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {t('tgList.clearRecent')}
            </button>
          </div>
          <div className="lg:px-1.5">
            {recent.map((c) => {
              const title = chatTitle(c, t)
              return (
                <div key={c.id} className="group/recent relative">
                  <button
                    type="button"
                    onClick={() => onPickChat(c.id, { remember: true })}
                    className={cn(RESULT_ROW, 'pr-10', activeId === c.id && 'bg-primary/10')}
                  >
                    <ChatAvatar id={c.id} title={title} url={c.avatarUrl} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRecent(c.id)}
                    aria-label={t('tgList.removeRecent', { name: title })}
                    className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground opacity-100 transition-[opacity,background-color] hover:bg-muted hover:text-foreground focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/recent:opacity-100"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ── «Чаты»: названия, люди своего вуза и сообщения ──────────────────────────
function ChatResults({
  activeId,
  locale,
  chatById,
  chatMatches,
  msgMatches,
  msgResultsLoading,
  peopleMatches,
  peopleLoading,
  startingPersonId,
  onOpenPerson,
  onPickChat,
  onPickMessage,
}: ChatListSearchProps) {
  const t = useTranslations('Chats')
  const tRoles = useTranslations('Roles')
  if (
    chatMatches.length === 0 &&
    msgMatches.length === 0 &&
    peopleMatches.length === 0 &&
    !msgResultsLoading &&
    !peopleLoading
  ) {
    return <NoResults />
  }
  return (
    <div className="flex shrink-0 flex-col lg:px-1.5">
      {chatMatches.length > 0 && (
        <section className="flex shrink-0 flex-col" aria-label={t('title')}>
          <p className={SECTION_TITLE}>{t('title')}</p>
          {chatMatches.map((c) => {
            const title = chatTitle(c, t)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onPickChat(c.id, { remember: true })}
                className={cn(RESULT_ROW, activeId === c.id && 'bg-primary/10')}
              >
                <ChatAvatar id={c.id} title={title} url={c.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{title}</span>
                  {c.lastMessage && (
                    <p className="truncate text-xs text-muted-foreground">
                      <MessagePreview message={c.lastMessage} />
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </section>
      )}
      {(peopleMatches.length > 0 || peopleLoading) && (
        <section className="flex shrink-0 flex-col" aria-label={t('peopleSection')}>
          <p className={SECTION_TITLE}>{t('peopleSection')}</p>
          {peopleLoading && peopleMatches.length === 0 ? (
            <Spinner />
          ) : (
            peopleMatches.map((u) => {
              const name = [u.lastName, u.firstName].filter(Boolean).join(' ')
              const busy = startingPersonId === u.id
              return (
                <button
                  key={u.id}
                  type="button"
                  disabled={startingPersonId !== null}
                  onClick={() => onOpenPerson(u)}
                  className={cn(RESULT_ROW, 'disabled:cursor-default disabled:opacity-70')}
                >
                  <ChatAvatar id={u.id} title={name} url={u.avatarThumbUrl ?? u.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{name}</span>
                    <p className="truncate text-xs text-muted-foreground">
                      {[u.headline || tRoles(u.role), u.groupName || u.facultyName]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {busy ? (
                    <Loader2
                      className="size-4 shrink-0 animate-spin text-muted-foreground"
                      aria-hidden
                    />
                  ) : (
                    // Другу сообщение уйдёт сразу — помечаем только тех, кому сначала уйдёт
                    // запрос: об этом лучше знать до клика.
                    !u.isFriend && (
                      <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                        {t('willRequest')}
                      </span>
                    )
                  )}
                </button>
              )
            })
          )}
        </section>
      )}
      {(msgMatches.length > 0 || msgResultsLoading) && (
        <section className="flex shrink-0 flex-col" aria-label={t('messagesSection')}>
          <p className={SECTION_TITLE}>{t('messagesSection')}</p>
          {msgResultsLoading ? (
            <Spinner />
          ) : (
            msgMatches.map((m) => {
              const chat = chatById.get(m.chatId)
              const chatName = chat ? chatTitle(chat, t) : t('typePrivate')
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onPickMessage(m.chatId, m.id)}
                  className={RESULT_ROW}
                >
                  <ChatAvatar id={m.chatId} title={chatName} url={chat?.avatarUrl ?? null} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {chatName}
                      </span>
                      <time
                        dateTime={m.createdAt}
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      >
                        {chatListTime(m.createdAt, locale)}
                      </time>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="text-foreground/70">{senderName(m)}: </span>
                      <MessagePreview message={m} />
                    </p>
                  </div>
                </button>
              )
            })
          )}
        </section>
      )}
    </div>
  )
}

// ── «Медиа», «Ссылки», «Файлы», «Музыка», «Голосовые» ──────────────────────
function MessageKindResults({
  kind,
  term,
  locale,
  chatById,
  onPickMessage,
}: ChatListSearchProps & { kind: MessageSearchKind }) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const unit = useByteUnitLabel()
  // Отбор вида — на сервере (`kind`): страница приходит плотной, а пустой запрос — это
  // последние материалы вида по всем чатам. Ключ свой у каждого вида и запроса.
  const q = useInfiniteQuery({
    queryKey: chatKeys.searchKind(kind, term),
    queryFn: ({ pageParam }) => searchMessages(term, undefined, pageParam, { kind }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
    staleTime: 30_000,
  })
  const messages = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  const hits = useMemo(
    () => (kind === 'link' ? [] : attachmentHits(messages, kind)),
    [messages, kind],
  )
  const links = useMemo(() => (kind === 'link' ? linkHits(messages) : []), [messages, kind])

  if (q.isLoading) return <Spinner />
  if (q.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <EmptyState
          title={t('tgList.searchError')}
          action={
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              <RotateCcw className="size-4" aria-hidden />
              {tCommon('retry')}
            </Button>
          }
        />
      </div>
    )
  }

  const count = kind === 'link' ? links.length : hits.length
  const more = q.hasNextPage && (
    <div className="p-2">
      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => void q.fetchNextPage()}
        disabled={q.isFetchingNextPage}
      >
        {q.isFetchingNextPage ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          t('tgList.searchMore')
        )}
      </Button>
    </div>
  )
  if (count === 0) {
    if (term) {
      return (
        <>
          <NoResults />
          {more}
        </>
      )
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <EmptyState icon={<KindIcon kind={kind} />} title={t(EMPTY_KIND_KEY[kind])} />
        {more}
      </div>
    )
  }

  const chatNameOf = (chatId: string): string => {
    const c = chatById.get(chatId)
    return c ? chatTitle(c, t) : t('typePrivate')
  }
  const meta = (parts: (string | null | undefined | false)[]): string =>
    parts.filter(Boolean).join(' · ')

  let body: ReactNode
  if (kind === 'media') {
    body = (
      <div className="grid grid-cols-3 gap-0.5 p-0.5">
        {hits.map(({ message: m, attachment: a }) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPickMessage(m.chatId, m.id)}
            aria-label={t('tgList.openInChat', { name: chatNameOf(m.chatId) })}
            className="relative aspect-square cursor-pointer overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
          >
            <MediaTile att={a} />
            {a.mime.startsWith('video/') && a.durationMs ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[0.7rem] font-medium tabular-nums text-white">
                {formatClock(a.durationMs)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    )
  } else if (kind === 'link') {
    body = (
      <div className="flex flex-col lg:px-1.5">
        {links.map(({ message: m, url, title, site }) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPickMessage(m.chatId, m.id)}
            className={RESULT_ROW}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
              <Link2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {title || site || hostOf(url)}
              </span>
              <p className="truncate text-xs text-info">{url}</p>
              <p className="truncate text-xs text-muted-foreground">
                {meta([chatNameOf(m.chatId), chatListTime(m.createdAt, locale)])}
              </p>
            </div>
          </button>
        ))}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col lg:px-1.5">
        {hits.map((hit) => (
          <AttachmentRow
            key={hit.attachment.id}
            kind={kind}
            title={
              kind === 'voice'
                ? senderName(hit.message)
                : hit.attachment.name || t('tgList.fileNoName')
            }
            subtitle={meta([
              kind === 'file' && formatBytes(hit.attachment.size, unit),
              kind !== 'file' && hit.attachment.durationMs
                ? formatClock(hit.attachment.durationMs)
                : null,
              kind === 'music' && senderName(hit.message),
              chatNameOf(hit.message.chatId),
              chatListTime(hit.message.createdAt, locale),
            ])}
            onPick={() => onPickMessage(hit.message.chatId, hit.message.id)}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 flex-col">
      {body}
      {more}
    </div>
  )
}

/** Строка файла, трека или голосового: значок вида, заголовок, подпись. */
function AttachmentRow({
  kind,
  title,
  subtitle,
  onPick,
}: {
  kind: 'file' | 'music' | 'voice'
  title: string
  subtitle: string
  onPick: () => void
}) {
  return (
    <button type="button" onClick={onPick} className={RESULT_ROW}>
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center bg-primary/10 text-primary',
          // Голосовое и трек — круг, как кнопка проигрывания в переписке; файл — «лист».
          kind === 'file' ? 'rounded-lg' : 'rounded-full',
        )}
      >
        <KindIcon kind={kind} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  )
}

function KindIcon({ kind }: { kind: MessageSearchKind }) {
  if (kind === 'voice') return <Mic className="size-5" aria-hidden />
  if (kind === 'music') return <Music className="size-5" aria-hidden />
  if (kind === 'link') return <Link2 className="size-5" aria-hidden />
  if (kind === 'file') return <FileText className="size-5" aria-hidden />
  return <Search className="size-6" aria-hidden />
}

/** Плитка медиа в сетке поиска: та же миниатюра, что в строке списка, растянутая на плитку. */
function MediaTile({ att }: { att: MessageAttachment }) {
  return <PreviewThumb att={att} large className="absolute inset-0 size-full rounded-none" />
}

function Spinner() {
  return (
    <div className="flex justify-center py-4 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
    </div>
  )
}

function NoResults() {
  const t = useTranslations('Chats')
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <EmptyState icon={<Search className="size-6" aria-hidden />} title={t('noResults')} />
    </div>
  )
}
