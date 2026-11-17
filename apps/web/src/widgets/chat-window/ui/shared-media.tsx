'use client'

import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  BarChart3,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ImagePlay,
  Link2,
  Loader2,
  Mic,
  Music,
  Pause,
  Play,
  RotateCcw,
  Save,
  X,
} from 'lucide-react'
import {
  chatKeys,
  fetchAttachmentLink,
  fetchChatLinks,
  fetchChatMedia,
  fetchChatPolls,
  fileKind,
  getAudioElement,
  MediaViewer,
  type ChatLinkItem,
  type ChatMediaItem,
  type ChatMessage,
  useAudioPlayer,
  usePlaylistQueue,
  VoiceRateButton,
} from '../../../entities/chat'
import { Button, EmptyState, MediaImage, ProgressRing, Skeleton } from '../../../shared/ui'
import {
  formatBytes,
  useByteUnitLabel,
  useFileDownload,
  useInfiniteScroll,
} from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

// Вкладки общих материалов правой колонки (Telegram-стиль): медиа сеткой три в ряд, файлы,
// ссылки, голосовые, музыка, GIF и опросы. Колонка прокручивается целиком (профиль сверху,
// вкладки липнут к верху), поэтому страницы подгружаются сами, когда список доходит до
// низа, — кнопки «Загрузить ещё» нет, как и в Telegram.

// Ссылка на вложение и его варианты (кэш общий с сообщениями: тот же ключ ['chat-attachment', id]).
function useFileLink(fileId: string, enabled = true) {
  return useQuery({
    queryKey: ['chat-attachment', fileId],
    queryFn: () => fetchAttachmentLink(fileId),
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
}

// Только presigned-URL оригинала (аудио, скачивание): в кэше лежит всё описание, `select`
// отдаёт из него ссылку, не заводя второй записи.
function useFileUrl(fileId: string, enabled = true) {
  return useQuery({
    queryKey: ['chat-attachment', fileId],
    queryFn: () => fetchAttachmentLink(fileId),
    select: (link) => link.url,
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
}

/** Подпись даты строки: «12 нояб.». */
function shortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
}

/** Длительность видео на плитке: «0:15», «12:04». */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Пустое состояние вкладки: обёртка — flex-колонка, чтобы `flex-1` внутри EmptyState
// растянул пунктирный блок на всю доступную высоту, а не полоской у верхнего края.
export function TabEmpty({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-64 flex-1 flex-col p-3">
      <EmptyState icon={icon} title={title} />
    </div>
  )
}

// Ошибка загрузки вкладки: сообщение и «Повторить» (FRONTEND_RULES §9).
export function TabError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  return (
    <div className="flex min-h-64 flex-1 flex-col p-3">
      <EmptyState
        title={t('sharedLoadError')}
        action={
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden />
            {tCommon('retry')}
          </Button>
        }
      />
    </div>
  )
}

/** Заглушка списка: строки той же геометрии, что у файлов и ссылок. */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Заглушка сетки медиа: квадраты три в ряд, как сама сетка. */
function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-px" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-none" />
      ))}
    </div>
  )
}

/**
 * Маячок подгрузки в конце списка: страница приходит до того, как читатель упрётся в дно.
 * Сбой следующей страницы не прячется — вместо крутилки кнопка «Повторить».
 */
function PageSentinel({
  hasNext,
  loading,
  failed,
  onLoad,
}: {
  hasNext: boolean
  loading: boolean
  failed: boolean
  onLoad: () => void
}) {
  const tCommon = useTranslations('Common')
  const ref = useInfiniteScroll<HTMLDivElement>({ hasNext: hasNext && !failed, loading, onLoad })
  if (!hasNext) return null
  return (
    <div ref={ref} className="flex h-12 items-center justify-center">
      {failed ? (
        <Button variant="ghost" size="sm" onClick={onLoad}>
          <RotateCcw className="size-4" aria-hidden />
          {tCommon('retry')}
        </Button>
      ) : (
        loading && (
          <Loader2
            className="size-5 animate-spin text-muted-foreground"
            aria-label={tCommon('loading')}
          />
        )
      )}
    </div>
  )
}

/** Бесконечный список материалов одного типа: общие для вкладок ветки загрузки и подгрузки. */
function useMediaPages(chatId: string, type: Parameters<typeof fetchChatMedia>[1]) {
  return useInfiniteQuery({
    queryKey: chatKeys.media(chatId, type),
    queryFn: ({ pageParam }) => fetchChatMedia(chatId, type, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
}

// ── Медиа: сетка три в ряд → полноэкранный просмотр ─────────────────────────
function MediaThumb({ item, onOpen }: { item: ChatMediaItem; onOpen: () => void }) {
  const t = useTranslations('Chats')
  const isVideo = item.mime.startsWith('video/')
  const link = useFileLink(item.id)
  // Миниатюра сетки — копия 320 (или постер видео), а не оригинал: вкладка показывает
  // десятки снимков разом. Нет копий — оригинал; у видео без постера — <video>.
  const poster = link.data?.poster ?? []
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('tgRight.openMedia')}
      className="relative aspect-square cursor-zoom-in overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {link.data ? (
        isVideo && poster.length === 0 ? (
          <video src={link.data.url} muted preload="metadata" className="size-full object-cover" />
        ) : (
          <MediaImage
            src={isVideo ? poster[poster.length - 1]?.url : link.data.url}
            media={{
              placeholder: item.placeholder,
              sources: isVideo ? poster : link.data.sources,
              width: isVideo ? null : item.width,
            }}
            alt=""
            sizes="140px"
            className="size-full"
          />
        )
      ) : item.placeholder ? (
        <MediaImage media={{ placeholder: item.placeholder }} alt="" className="size-full" />
      ) : (
        <div className="size-full animate-pulse bg-muted" />
      )}
      {/* Видео отличается от снимка длительностью в углу, как в Telegram: значок «▶»
          поверх каждой второй плитки превращал сетку в стену кнопок. */}
      {isVideo && (
        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/55 px-1 py-px text-[0.6875rem] font-medium tabular-nums text-white">
          <Play className="size-2.5 fill-current" aria-hidden />
          {item.durationMs ? formatDuration(item.durationMs) : null}
        </span>
      )}
    </button>
  )
}

export function MediaTab({ chatId }: { chatId: string }) {
  const t = useTranslations('Chats')
  const [viewer, setViewer] = useState<number | null>(null)
  const q = useMediaPages(chatId, 'media')
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <GridSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0)
    return <TabEmpty icon={<ImageIcon className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  // Для просмотрщика маппим ChatMediaItem → MessageAttachment (viewer сам тянет presigned-URL).
  const attachments = items.map((it) => ({
    id: it.id,
    mime: it.mime,
    size: it.size,
    name: it.name,
    // Заглушка и размеры — чтобы просмотрщик показал силуэт снимка, не дожидаясь ссылки.
    width: it.width,
    height: it.height,
    placeholder: it.placeholder,
    durationMs: it.durationMs,
  }))
  return (
    <>
      <div className="grid grid-cols-3 gap-px">
        {items.map((it, i) => (
          <MediaThumb key={it.id} item={it} onOpen={() => setViewer(i)} />
        ))}
      </div>
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
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

// ── Файлы: список ───────────────────────────────────────────────────────────
function FileRow({
  item,
  onJump,
  locale,
}: {
  item: ChatMediaItem
  onJump: (id: string) => void
  locale: string
}) {
  const unit = useByteUnitLabel()
  const t = useTranslations('Chats')
  const dl = useFileUrl(item.id, false)
  // Скачивание в приложение с прогрессом — тем же ключом, что у файла в самой переписке.
  // Ссылка подписывается по нажатию: список файлов длинный, и подписывать все заранее незачем.
  const download = useFileDownload(`file:${item.id}`, {
    url: () => dl.refetch().then((r) => r.data),
    name: item.name ?? t('attachment'),
    mime: item.mime,
  })
  const state = download.state
  const kind = fileKind(item.name, item.mime)
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 transition-colors hover:bg-muted/40">
      <button
        type="button"
        onClick={() => onJump(item.messageId)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {/* Тот же значок расширения, что в ленте: один и тот же файл нельзя показывать
            двумя разными способами в двух местах одного экрана. */}
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-lg text-white',
            kind.className,
          )}
        >
          {kind.ext ? (
            <span className="text-[0.65rem] font-bold uppercase leading-none tracking-tight">
              {kind.ext}
            </span>
          ) : (
            <FileText className="size-5" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.name ?? t('attachment')}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatBytes(item.size, unit)} · {shortDate(item.createdAt, locale)}
          </span>
        </span>
      </button>
      {/* Кнопка ведёт себя как значок файла в Telegram: «↓» скачать, кольцо с «×» —
          идёт скачивание (нажатие отменяет), «сохранить» — файл уже в приложении. */}
      <button
        type="button"
        aria-label={
          state.status === 'loading'
            ? t('downloadCancel')
            : state.status === 'ready'
              ? t('save')
              : t('download')
        }
        title={state.status === 'error' ? t('downloadFailed') : undefined}
        onClick={download.toggle}
        className={cn(
          'relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring/20',
          state.status === 'ready' ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          state.status === 'error' && 'text-destructive',
        )}
      >
        {state.status === 'loading' ? (
          <>
            <X className="size-3.5" strokeWidth={2.5} aria-hidden />
            <ProgressRing progress={download.progress} className="text-primary" />
          </>
        ) : state.status === 'ready' ? (
          <Save className="size-4" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

/**
 * Голосовые и музыка правой панели — очередь общего аудиоплеера (entities/chat, тот же звук,
 * что у ленты): запуск отсюда останавливает играющее в ленте и наоборот, панель под шапкой
 * чата показывает трек, автопереход идёт вниз по списку, скорость — общая запомненная.
 */
function VoicePlaylist({
  chatId,
  type,
  items,
  onJump,
  locale,
}: {
  chatId: string
  type: 'voice_note' | 'music'
  items: ChatMediaItem[]
  onJump: (id: string) => void
  locale: string
}) {
  const t = useTranslations('Chats')
  const unit = useByteUnitLabel()
  const player = useAudioPlayer()
  const music = type === 'music'
  const toggle = usePlaylistQueue(`panel:${chatId}:${type}`, chatId, items, t('attachment'))

  return (
    <>
      {items.map((it) => {
        const active = player.track?.id === it.id
        const playing = active && player.playing
        const author = it.sender ? `${it.sender.lastName} ${it.sender.firstName}`.trim() : null
        return (
          <div
            key={it.id}
            className={cn('flex items-center gap-3 px-4 py-2', active && 'bg-primary/5')}
          >
            <button
              type="button"
              aria-label={playing ? t('pause') : t('play')}
              onClick={() => toggle(it.id)}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-ring/20"
            >
              {active && player.loading && !player.playing ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : playing ? (
                <Pause className="size-5 fill-current" aria-hidden />
              ) : (
                <Play className="ml-0.5 size-5 fill-current" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => onJump(it.messageId)}
              className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="block truncate text-sm font-medium">
                {music ? (it.name ?? t('attachment')) : (author ?? t('attachment'))}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {music && author && `${author} · `}
                {it.durationMs
                  ? `${formatDuration(it.durationMs)} · `
                  : `${formatBytes(it.size, unit)} · `}
                {shortDate(it.createdAt, locale)}
              </span>
              {/* Полоса прогресса только у играющей записи — у остальных она была бы шумом. */}
              {active && <PlaylistProgress playing={player.playing} duration={player.duration} />}
            </button>
            {active && !music && <VoiceRateButton />}
          </div>
        )
      })}
    </>
  )
}

/**
 * Прогресс играющей строки — из общего элемента звука, каждый кадр и прямо в DOM: по
 * timeupdate полоса ползла бы ступеньками, а ререндер списка на каждом кадре незачем.
 */
function PlaylistProgress({ playing, duration }: { playing: boolean; duration: number }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const bar = ref.current
    const a = getAudioElement()
    if (!bar || !a) return
    const paint = (): void => {
      const d = duration > 0 ? duration : knownDuration(a)
      bar.style.transform = `scaleX(${d ? Math.min(1, a.currentTime / d) : 0})`
    }
    paint()
    a.addEventListener('seeked', paint)
    if (!playing) return () => a.removeEventListener('seeked', paint)
    let frame = requestAnimationFrame(function loop() {
      paint()
      frame = requestAnimationFrame(loop)
    })
    return () => {
      cancelAnimationFrame(frame)
      a.removeEventListener('seeked', paint)
    }
  }, [playing, duration])
  return (
    <span className="mt-1 block h-0.5 w-full overflow-hidden rounded-full bg-muted">
      <span ref={ref} className="block h-full origin-left scale-x-0 bg-primary" />
    </span>
  )
}

function knownDuration(a: HTMLAudioElement): number {
  return Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0
}

// Голосовые — только записи с микрофона (`voice_note`): `voice` отдаёт всё аудио, и музыка
// попадала бы в список голосовых. Музыка — своя вкладка (`music`).
const FILE_TAB_ICON = {
  file: FileText,
  voice_note: Mic,
  music: Music,
} as const

export function FileTab({
  chatId,
  type,
  onJump,
}: {
  chatId: string
  type: 'file' | 'voice_note' | 'music'
  onJump: (id: string) => void
}) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const q = useMediaPages(chatId, type)
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  // Плеер дошёл до конца загруженного списка панели — следующую страницу берём заранее,
  // чтобы автопереход не упёрся в край и не закрыл плеер посреди списка.
  const player = useAudioPlayer()
  const playingHere =
    type !== 'file' && player.track?.queueKey === `panel:${chatId}:${type}` ? player.track.id : null
  const playingAt = playingHere ? items.findIndex((it) => it.id === playingHere) : -1
  const nearEnd = playingAt >= 0 && playingAt >= items.length - 2
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q
  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [nearEnd, hasNextPage, isFetchingNextPage, fetchNextPage])
  if (q.isLoading) return <RowsSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0) {
    const Icon = FILE_TAB_ICON[type]
    return <TabEmpty icon={<Icon className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  }
  return (
    <div className="py-1">
      {type !== 'file' ? (
        <VoicePlaylist chatId={chatId} type={type} items={items} onJump={onJump} locale={locale} />
      ) : (
        items.map((it) => <FileRow key={it.id} item={it} onJump={onJump} locale={locale} />)
      )}
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
    </div>
  )
}

// ── GIF: анимированная сетка ─────────────────────────────────────────────────
// Оригинал, а не копия: уменьшенные варианты медиа-системы статичны, и GIF в них не
// двигается. Клик — к сообщению в переписке, как у файлов.
function GifThumb({ item, onJump }: { item: ChatMediaItem; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const link = useFileLink(item.id)
  return (
    <button
      type="button"
      onClick={() => onJump(item.messageId)}
      aria-label={t('goToMessage')}
      className="relative aspect-square overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {link.data ? (
        // Подписанная ссылка на приватный бакет: next/image её не оптимизирует.
        <img src={link.data.url} alt="" loading="lazy" className="size-full object-cover" />
      ) : item.placeholder ? (
        <MediaImage media={{ placeholder: item.placeholder }} alt="" className="size-full" />
      ) : (
        <div className="size-full animate-pulse bg-muted" />
      )}
    </button>
  )
}

export function GifTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const q = useMediaPages(chatId, 'gif')
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <GridSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0)
    return <TabEmpty icon={<ImagePlay className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  return (
    <>
      <div className="grid grid-cols-3 gap-px">
        {items.map((it) => (
          <GifThumb key={it.id} item={it} onJump={onJump} />
        ))}
      </div>
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
    </>
  )
}

// ── Опросы: список, клик — к опросу в переписке ──────────────────────────────
function PollRow({
  message,
  onJump,
  locale,
}: {
  message: ChatMessage
  onJump: (id: string) => void
  locale: string
}) {
  const t = useTranslations('Chats')
  const poll = message.poll
  if (!poll) return null
  const author = `${message.sender.lastName} ${message.sender.firstName}`
  return (
    <button
      type="button"
      onClick={() => onJump(message.id)}
      className="flex w-full items-center gap-3 px-4 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <BarChart3 className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{poll.question}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {poll.closed && `${t('pollClosed')} · `}
          {author} · {shortDate(message.createdAt, locale)}
        </span>
      </span>
    </button>
  )
}

export function PollsTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const q = useInfiniteQuery({
    queryKey: chatKeys.polls(chatId),
    queryFn: ({ pageParam }) => fetchChatPolls(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <RowsSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0)
    return <TabEmpty icon={<BarChart3 className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  return (
    <div className="py-1">
      {items.map((m) => (
        <PollRow key={m.id} message={m} onJump={onJump} locale={locale} />
      ))}
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
    </div>
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
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 transition-colors hover:bg-muted/40">
      <button
        type="button"
        onClick={() => onJump(item.messageId)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {/* Первая буква домена в квадрате — как плитка ссылки без картинки в Telegram. */}
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base font-semibold uppercase text-primary">
          {host.charAt(0) || <Link2 className="size-5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{lp.title || host}</span>
          <span className="block truncate text-xs text-primary">{host}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {shortDate(item.createdAt, locale)}
          </span>
        </span>
      </button>
      <a
        href={lp.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('openLink')}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20"
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
    </div>
  )
}

export function LinksTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const q = useInfiniteQuery({
    queryKey: chatKeys.links(chatId),
    queryFn: ({ pageParam }) => fetchChatLinks(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <RowsSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0)
    return <TabEmpty icon={<Link2 className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  return (
    <div className="py-1">
      {items.map((it) => (
        <LinkRow key={it.messageId} item={it} onJump={onJump} locale={locale} />
      ))}
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
    </div>
  )
}
