'use client'

import { useMemo, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { FileText, Link2, Loader2, RotateCcw, Search, X } from 'lucide-react'
import {
  attachmentKind,
  chatKeys,
  searchMessages,
  type ChatListItem,
  type ChatMessage,
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
import { MessagePreview, PreviewThumb } from './chat-list-preview'

/** Вкладки глобального поиска (Telegram-стиль). Голосовых нет — см. отчёт: сервер их не ищет. */
export type SearchTab = 'chats' | 'media' | 'links' | 'files'
export const SEARCH_TABS: SearchTab[] = ['chats', 'media', 'links', 'files']
export const SEARCH_TAB_KEY: Record<SearchTab, string> = {
  chats: 'tgList.searchChats',
  media: 'tgList.searchMedia',
  links: 'tgList.searchLinks',
  files: 'tgList.searchFiles',
}

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
  recentIds: string[]
  onClearRecent: () => void
  onRemoveRecent: (chatId: string) => void
}

/**
 * Глобальный поиск левой колонки: вкладки «Чаты · Медиа · Ссылки · Файлы», как в Telegram.
 *
 * Пустой запрос во вкладке «Чаты» — не пустота, а «недавние»: ряд частых собеседников и чаты,
 * которые человек уже находил поиском. Медиа, ссылки и файлы ищутся по тексту сообщений —
 * у `GET /chats/search` нет фильтра по виду вложения, поэтому вид отбирается на клиенте по
 * странице выдачи, а «Показать ещё» догружает следующую.
 */
export function ChatListSearch(props: ChatListSearchProps) {
  if (props.tab === 'chats') {
    return props.term.length >= 2 ? <ChatResults {...props} /> : <RecentView {...props} />
  }
  return <MessageKindResults {...props} tab={props.tab} />
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

// ── Пустой запрос: частые собеседники и недавние ────────────────────────────
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
  // «Частые» — личные чаты с самой свежей перепиской: отдельной статистики «с кем чаще» у
  // сервера нет, а свежесть — честное приближение.
  const top = useMemo(
    () =>
      chats
        .filter((c) => c.type === 'PRIVATE' && !c.archived && !c.requestIncoming && c.lastMessage)
        .sort(
          (a, b) =>
            new Date(b.lastMessage?.createdAt ?? 0).getTime() -
            new Date(a.lastMessage?.createdAt ?? 0).getTime(),
        )
        .slice(0, TOP_PEERS),
    [chats],
  )
  // Недавние, которых уже нет в списке (вышел из группы, чат удалён), просто не показываем.
  const recent = recentIds.flatMap((id) => {
    const c = chatById.get(id)
    return c ? [c] : []
  })

  if (top.length === 0 && recent.length === 0) {
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
        <section aria-label={t('tgList.topPeers')} className="border-b border-border pb-2">
          <p className={SECTION_TITLE}>{t('tgList.topPeers')}</p>
          <ScrollRow className="gap-1 px-1">
            {top.map((c) => {
              const title = chatTitle(c, t)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPickChat(c.id, { remember: true })}
                  className="flex w-[4.5rem] shrink-0 cursor-pointer flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="relative">
                    <ChatAvatar
                      id={c.id}
                      title={title}
                      url={c.avatarUrl}
                      className="size-[3.375rem]"
                    />
                    {c.online && (
                      <span
                        className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-background bg-success"
                        aria-hidden
                      />
                    )}
                  </span>
                  <span className="w-full truncate text-center text-xs">
                    {/* Название личного чата — «Фамилия Имя»; в подписи хватает имени. */}
                    {title.split(' ').slice(-1)[0]}
                  </span>
                </button>
              )
            })}
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
                  onClick={() => onPickChat(m.chatId)}
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

// ── «Медиа», «Ссылки», «Файлы» ─────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>()]+/i

/** Первая ссылка сообщения: превью сервера или адрес из текста. */
function linkOf(m: ChatMessage): { url: string; title: string | null; site: string | null } | null {
  if (m.linkPreview) {
    return {
      url: m.linkPreview.url,
      title: m.linkPreview.title,
      site: m.linkPreview.siteName,
    }
  }
  const found = URL_RE.exec(m.content ?? '')
  return found ? { url: found[0], title: null, site: null } : null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function MessageKindResults({
  tab,
  term,
  locale,
  chatById,
  onPickChat,
}: ChatListSearchProps & { tab: Exclude<SearchTab, 'chats'> }) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const unit = useByteUnitLabel()
  const enabled = term.length >= 2
  // Ключ — свой у каждой вкладки: окно чата держит под `chatKeys.search(term)` обычный
  // запрос, а здесь страницы; одинаковый ключ у разных форм данных сломал бы оба.
  const q = useInfiniteQuery({
    queryKey: [...chatKeys.search(term, undefined), 'tab', tab],
    queryFn: ({ pageParam }) =>
      searchMessages(term, undefined, pageParam, tab === 'links' ? undefined : { hasFile: true }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
    enabled,
  })
  const messages = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])

  const media = useMemo(
    () =>
      messages.flatMap((m) =>
        (m.media ?? [])
          .filter((a) => {
            const kind = attachmentKind(a)
            return tab === 'media' ? kind === 'photo' || kind === 'video' : kind === 'file'
          })
          .map((a) => ({ m, a })),
      ),
    [messages, tab],
  )
  const links = useMemo(
    () =>
      tab === 'links'
        ? messages.flatMap((m) => {
            const link = linkOf(m)
            return link ? [{ m, link }] : []
          })
        : [],
    [messages, tab],
  )

  if (!enabled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <EmptyState
          icon={<Search className="size-6" aria-hidden />}
          title={t('tgList.searchHintTitle')}
          description={t('tgList.searchKindHint')}
        />
      </div>
    )
  }
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

  const count = tab === 'links' ? links.length : media.length
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
    // Страница выдачи могла не содержать нужного вида — есть ещё страницы, даём догрузить.
    return (
      <>
        <NoResults />
        {more}
      </>
    )
  }

  const chatNameOf = (chatId: string): string => {
    const c = chatById.get(chatId)
    return c ? chatTitle(c, t) : t('typePrivate')
  }

  let body: ReactNode
  if (tab === 'media') {
    body = (
      <div className="grid grid-cols-3 gap-0.5 p-0.5">
        {media.map(({ m, a }) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPickChat(m.chatId)}
            aria-label={t('tgList.openInChat', { name: chatNameOf(m.chatId) })}
            className="relative aspect-square cursor-pointer overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
          >
            <MediaTile att={a} />
          </button>
        ))}
      </div>
    )
  } else if (tab === 'files') {
    body = (
      <div className="flex flex-col lg:px-1.5">
        {media.map(({ m, a }) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPickChat(m.chatId)}
            className={RESULT_ROW}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {a.name || t('tgList.fileNoName')}
              </span>
              <p className="truncate text-xs text-muted-foreground">
                {formatBytes(a.size, unit)} · {chatNameOf(m.chatId)} ·{' '}
                {chatListTime(m.createdAt, locale)}
              </p>
            </div>
          </button>
        ))}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col lg:px-1.5">
        {links.map(({ m, link }) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPickChat(m.chatId)}
            className={RESULT_ROW}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
              <Link2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {link.title || link.site || hostOf(link.url)}
              </span>
              <p className="truncate text-xs text-info">{link.url}</p>
              <p className="truncate text-xs text-muted-foreground">
                {chatNameOf(m.chatId)} · {chatListTime(m.createdAt, locale)}
              </p>
            </div>
          </button>
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
