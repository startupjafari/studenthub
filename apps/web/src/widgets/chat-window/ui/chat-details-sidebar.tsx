'use client'

import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  Check,
  Bell,
  BellOff,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  Play,
  Settings2,
  Shield,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import {
  chatKeys,
  fetchAttachmentUrl,
  fetchChatLinks,
  fetchChatMedia,
  fetchChatMembers,
  MediaViewer,
  type ChatLinkItem,
  type ChatListItem,
  type ChatMediaItem,
} from '../../../entities/chat'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
]

// §17: варианты «заглушить на время».
const MUTE_DURATIONS: { key: string; mode: number | 'forever' }[] = [
  { key: 'mute1h', mode: 60 },
  { key: 'mute4h', mode: 240 },
  { key: 'mute8h', mode: 480 },
  { key: 'mute1d', mode: 1440 },
  { key: 'mute3d', mode: 4320 },
  { key: 'muteForever', mode: 'forever' },
]

function colorOf(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? 'bg-sky-500'
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '#'
  )
}

// §49: относительное «был N назад» из ISO last-seen.
function lastSeenText(iso: string, t: (k: string, v?: Record<string, number>) => string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return t('lastSeenNow')
  if (min < 60) return t('lastSeenMin', { count: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('lastSeenHour', { count: hr })
  return t('lastSeenDay', { count: Math.floor(hr / 24) })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// presigned-URL вложения (кэш общий с сообщениями: тот же ключ ['chat-attachment', id]).
function useFileUrl(fileId: string, enabled = true) {
  return useQuery({
    queryKey: ['chat-attachment', fileId],
    queryFn: () => fetchAttachmentUrl(fileId),
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
}

function Empty({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="p-6">
      <EmptyState icon={icon} title={title} />
    </div>
  )
}

function LoadMore({
  onClick,
  loading,
  label,
}: {
  onClick: () => void
  loading: boolean
  label: string
}) {
  return (
    <div className="p-2">
      <Button variant="ghost" size="sm" className="w-full" onClick={onClick} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : label}
      </Button>
    </div>
  )
}

// ── Медиа: сетка миниатюр → fullscreen viewer (§42) ──────────────────────────
function MediaThumb({ item, onOpen }: { item: ChatMediaItem; onOpen: () => void }) {
  const isVideo = item.mime.startsWith('video/')
  const url = useFileUrl(item.id)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-square overflow-hidden rounded-md bg-muted"
    >
      {url.data ? (
        isVideo ? (
          <video src={url.data} muted preload="metadata" className="size-full object-cover" />
        ) : (
          <img src={url.data} alt="" loading="lazy" className="size-full object-cover" />
        )
      ) : (
        <div className="size-full animate-pulse bg-muted" />
      )}
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
          <Play className="size-5" aria-hidden />
        </span>
      )}
    </button>
  )
}

function MediaTab({ chatId }: { chatId: string }) {
  const t = useTranslations('Chats')
  const [viewer, setViewer] = useState<number | null>(null)
  const q = useInfiniteQuery({
    queryKey: chatKeys.media(chatId, 'media'),
    queryFn: ({ pageParam }) => fetchChatMedia(chatId, 'media', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-1 p-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    )
  }
  if (items.length === 0)
    return <Empty icon={<ImageIcon className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  // Для fullscreen-viewer маппим ChatMediaItem → MessageAttachment (viewer сам тянет presigned-URL).
  const attachments = items.map((it) => ({
    id: it.id,
    mime: it.mime,
    size: it.size,
    name: it.name,
  }))
  return (
    <>
      <div className="grid grid-cols-3 gap-1 p-1">
        {items.map((it, i) => (
          <MediaThumb key={it.id} item={it} onOpen={() => setViewer(i)} />
        ))}
      </div>
      {q.hasNextPage && (
        <LoadMore
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          label={t('loadMore')}
        />
      )}
      {viewer !== null && (
        <MediaViewer
          items={attachments}
          index={viewer}
          onIndexChange={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  )
}

// ── Файлы / Голос: список ────────────────────────────────────────────────────
function FileRow({
  item,
  voice,
  onJump,
  locale,
}: {
  item: ChatMediaItem
  voice: boolean
  onJump: (id: string) => void
  locale: string
}) {
  const t = useTranslations('Chats')
  // Для голосовых сразу подгружаем URL (нативный плеер); для файлов — по клику на скачивание.
  const url = useFileUrl(item.id, voice)
  const dl = useFileUrl(item.id, false)
  const date = new Date(item.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  })
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        onClick={() => onJump(item.messageId)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {voice ? (
            <Mic className="size-4" aria-hidden />
          ) : (
            <FileText className="size-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.name ?? t('attachment')}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatBytes(item.size)} · {date}
          </span>
        </span>
      </button>
      {voice ? (
        url.data ? (
          <audio src={url.data} controls preload="none" className="h-8 w-32 shrink-0" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        )
      ) : (
        <button
          type="button"
          aria-label={t('download')}
          onClick={() => void dl.refetch().then((r) => r.data && window.open(r.data, '_blank'))}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Download className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function FileTab({
  chatId,
  voice,
  onJump,
}: {
  chatId: string
  voice: boolean
  onJump: (id: string) => void
}) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const type = voice ? 'voice' : 'file'
  const q = useInfiniteQuery({
    queryKey: chatKeys.media(chatId, type),
    queryFn: ({ pageParam }) => fetchChatMedia(chatId, type, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    )
  }
  if (items.length === 0) {
    const icon = voice ? (
      <Mic className="size-6" aria-hidden />
    ) : (
      <FileText className="size-6" aria-hidden />
    )
    return <Empty icon={icon} title={t('sharedEmpty')} />
  }
  return (
    <>
      {items.map((it) => (
        <FileRow key={it.id} item={it} voice={voice} onJump={onJump} locale={locale} />
      ))}
      {q.hasNextPage && (
        <LoadMore
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          label={t('loadMore')}
        />
      )}
    </>
  )
}

// ── Ссылки: список ───────────────────────────────────────────────────────────
function LinkRow({
  item,
  onJump,
  locale,
}: {
  item: ChatLinkItem
  onJump: (id: string) => void
  locale: string
}) {
  const t = useTranslations('Chats')
  const lp = item.linkPreview
  if (!lp) return null
  let host = lp.url
  try {
    host = new URL(lp.url).hostname.replace(/^www\./, '')
  } catch {
    /* оставляем как есть */
  }
  const date = new Date(item.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  })
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        onClick={() => onJump(item.messageId)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Link2 className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{lp.title || host}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {host} · {date}
          </span>
        </span>
      </button>
      <a
        href={lp.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('openLink')}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
    </div>
  )
}

function LinksTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const q = useInfiniteQuery({
    queryKey: chatKeys.links(chatId),
    queryFn: ({ pageParam }) => fetchChatLinks(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <Skeleton className="h-4 w-44" />
          </div>
        ))}
      </div>
    )
  }
  if (items.length === 0)
    return <Empty icon={<Link2 className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  return (
    <>
      {items.map((it) => (
        <LinkRow key={it.messageId} item={it} onJump={onJump} locale={locale} />
      ))}
      {q.hasNextPage && (
        <LoadMore
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          label={t('loadMore')}
        />
      )}
    </>
  )
}

// Правая панель деталей чата (Telegram-стиль §55): профиль + уведомления + вкладки
// Участники / Медиа / Файлы / Ссылки / Голос (§23, реальные данные из gallery-эндпоинтов).
// Докается третьей колонкой на десктопе (≥xl), не закрывая переписку. Клик по материалу —
// onJump к сообщению-источнику (подгружает окно around при необходимости). Полное управление
// группой — через существующую модалку GroupInfoDialog (кнопка «Управление»).
export function ChatDetailsSidebar({
  chat,
  title,
  isPrivate,
  peerOnline = false,
  onClose,
  onMute,
  onUnmute,
  onManageGroup,
  onOpenPeerProfile,
  onJump,
}: {
  chat: ChatListItem
  title: string
  isPrivate: boolean
  peerOnline?: boolean
  onClose: () => void
  // §17: заглушить на время (minutes) или навсегда ('forever'); onUnmute — включить.
  // importantOnly — режим «только важные»: ответы мне и упоминания уведомляют и в mute.
  onMute: (mode: number | 'forever', importantOnly?: boolean) => void
  onUnmute: () => void
  onManageGroup: () => void
  onOpenPeerProfile?: () => void
  onJump: (messageId: string) => void
}) {
  const t = useTranslations('Chats')
  const tr = useTranslations('Roles')
  const isGroup = !isPrivate
  const [muteMenuOpen, setMuteMenuOpen] = useState(false)
  // Режим выбирается до срока: галочка применяется к любому выбранному сроку заглушения.
  const [importantOnly, setImportantOnly] = useState(false)

  const members = useQuery({
    queryKey: chatKeys.members(chat.id),
    queryFn: () => fetchChatMembers(chat.id),
    enabled: isGroup,
  })
  const memberList = members.data ?? []

  const subtitle = isPrivate
    ? peerOnline
      ? t('online')
      : t('offlineStatus')
    : t('participants', { count: chat.memberCount })

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-border px-2 py-3">
        <button
          type="button"
          aria-label={t('cancel')}
          onClick={onClose}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
        >
          <X className="size-5" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{t('details')}</span>
      </div>

      <div className="flex flex-col items-center gap-2 border-b border-border p-5">
        <Avatar className="size-20">
          {chat.avatarUrl && <AvatarImage src={chat.avatarUrl} alt={title} />}
          <AvatarFallback className={cn('text-2xl font-medium text-white', colorOf(chat.id))}>
            {initialsOf(title)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 text-center">
          <p className="truncate text-lg font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {chat.muted ? (
            <Button variant="outline" size="sm" onClick={onUnmute}>
              <Bell className="size-3.5" aria-hidden />
              {chat.mutedImportantOnly ? t('unmuteImportantOnly') : t('unmute')}
            </Button>
          ) : (
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setMuteMenuOpen((v) => !v)}>
                <BellOff className="size-3.5" aria-hidden />
                {t('mute')}
              </Button>
              {muteMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMuteMenuOpen(false)} />
                  <div className="absolute left-1/2 top-full z-50 mt-1 w-52 -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
                    {/* §17: «только важные» — не отдельный срок, а модификатор к выбранному:
                        чат заглушён, но ответы мне и упоминания меня всё равно уведомляют. */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={importantOnly}
                      onClick={() => setImportantOnly((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          importantOnly
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
                        )}
                        aria-hidden
                      >
                        {importantOnly && <Check className="size-3" />}
                      </span>
                      {t('muteImportantOnly')}
                    </button>
                    <div className="my-1 h-px bg-border" aria-hidden />
                    {MUTE_DURATIONS.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => {
                          setMuteMenuOpen(false)
                          onMute(d.mode, importantOnly)
                        }}
                        className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {t(d.key)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {isGroup ? (
            <Button variant="outline" size="sm" onClick={onManageGroup}>
              <Settings2 className="size-3.5" aria-hidden />
              {t('manage')}
            </Button>
          ) : (
            onOpenPeerProfile && (
              <Button variant="outline" size="sm" onClick={onOpenPeerProfile}>
                <UserRound className="size-3.5" aria-hidden />
                {t('openProfile')}
              </Button>
            )
          )}
        </div>
      </div>

      <Tabs
        defaultValue={isGroup ? 'participants' : 'media'}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-2 mt-2 grid shrink-0 grid-flow-col justify-stretch">
          {isGroup && (
            <TabsTrigger value="participants" aria-label={t('tabParticipants')}>
              <Users className="size-4" aria-hidden />
            </TabsTrigger>
          )}
          <TabsTrigger value="media" aria-label={t('tabMedia')}>
            <ImageIcon className="size-4" aria-hidden />
          </TabsTrigger>
          <TabsTrigger value="files" aria-label={t('tabFiles')}>
            <FileText className="size-4" aria-hidden />
          </TabsTrigger>
          <TabsTrigger value="links" aria-label={t('tabLinks')}>
            <Link2 className="size-4" aria-hidden />
          </TabsTrigger>
          <TabsTrigger value="voice" aria-label={t('tabVoice')}>
            <Mic className="size-4" aria-hidden />
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isGroup && (
            <TabsContent value="participants" className="mt-0 p-1">
              {members.isLoading ? (
                <div className="space-y-1 p-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-2 py-2">
                      <Skeleton className="size-9 shrink-0 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
              ) : memberList.length === 0 ? (
                <Empty icon={<Users className="size-6" aria-hidden />} title={t('sharedEmpty')} />
              ) : (
                <ul>
                  {memberList.map((m) => {
                    const name = `${m.firstName} ${m.lastName}`.trim()
                    return (
                      <li key={m.id}>
                        <div className="flex w-full items-center gap-3 px-3 py-2">
                          <span className="relative shrink-0">
                            <Avatar className="size-9">
                              {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={name} />}
                              <AvatarFallback className={cn('text-white', colorOf(m.id))}>
                                {initialsOf(name)}
                              </AvatarFallback>
                            </Avatar>
                            {m.online && (
                              <span
                                className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-background bg-green-500"
                                aria-hidden
                              />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {m.online
                                ? tr(m.role)
                                : m.lastSeenAt
                                  ? lastSeenText(m.lastSeenAt, t)
                                  : tr(m.role)}
                            </p>
                          </div>
                          {m.isAdmin && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                              <Shield className="size-3" aria-hidden />
                              {t('adminBadge')}
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </TabsContent>
          )}
          <TabsContent value="media" className="mt-0">
            <MediaTab chatId={chat.id} />
          </TabsContent>
          <TabsContent value="files" className="mt-0">
            <FileTab chatId={chat.id} voice={false} onJump={onJump} />
          </TabsContent>
          <TabsContent value="links" className="mt-0">
            <LinksTab chatId={chat.id} onJump={onJump} />
          </TabsContent>
          <TabsContent value="voice" className="mt-0">
            <FileTab chatId={chat.id} voice onJump={onJump} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
