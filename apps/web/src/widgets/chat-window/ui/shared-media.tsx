'use client'

import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  BarChart3,
  Download,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  Music,
  Pause,
  Play,
  RotateCcw,
  Save,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  chatKeys,
  fetchAttachmentLink,
  fetchChatLinks,
  fetchChatMedia,
  fetchChatPolls,
  ChatMediaRailViewer,
  fileKind,
  getAudioElement,
  LONG_AUDIO_SEC,
  type ChatLinkItem,
  type ChatMediaItem,
  type ChatMessage,
  useAudioPlayer,
  usePlaylistQueue,
  VoiceRateButton,
} from '../../../entities/chat'
import { Button, MediaImage, ProgressRing, Skeleton } from '../../../shared/ui'
import {
  formatBytes,
  toApiError,
  useByteUnitLabel,
  useFileDownload,
  useInfiniteScroll,
} from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { chatListTime } from '../lib/list-time'
import { ManageEmpty } from './group-manage-kit'

// Вкладки общих материалов правой колонки (Telegram-стиль): медиа сеткой три в ряд, файлы,
// ссылки, голосовые, музыка и опросы. Колонка прокручивается целиком (профиль сверху,
// вкладки липнут к верху), поэтому страницы подгружаются сами, когда список доходит до
// низа, — кнопки «Загрузить ещё» нет, как и в Telegram.

// Ссылка на вложение — отдельный GET на каждую плитку, а общий лимит API — сотня запросов в
// минуту. Поэтому плитка просит ссылку, только когда её видно (useNearView), а упёршись в
// лимит (429 `RATE_LIMIT`), не сдаётся после одного повтора: ждёт, пока окно лимита
// сдвинется, — иначе часть сетки так и оставалась незагруженной.
const RATE_LIMIT_RETRIES = 4

export function isRateLimited(error: unknown): boolean {
  return toApiError(error).code === 'RATE_LIMIT'
}

/** Повторять ли запрос ссылки: лимит — несколько раз с выдержкой, прочее — один раз. */
export function linkRetry(failures: number, error: unknown): boolean {
  return isRateLimited(error) ? failures < RATE_LIMIT_RETRIES : failures < 1
}

/** Выдержка перед повтором: при 429 — 5, 10, 20, 40 с (вместе дольше минутного окна лимита). */
export function linkRetryDelay(failures: number, error: unknown): number {
  if (isRateLimited(error)) return 5000 * 2 ** Math.min(failures, RATE_LIMIT_RETRIES - 1)
  return Math.min(1000 * 2 ** failures, 30_000)
}

// Ссылка на вложение и его варианты (кэш общий с сообщениями: тот же ключ ['chat-attachment', id]).
function useFileLink(fileId: string, enabled = true) {
  return useQuery({
    queryKey: ['chat-attachment', fileId],
    queryFn: () => fetchAttachmentLink(fileId),
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: linkRetry,
    retryDelay: linkRetryDelay,
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

/** Сколько плитка должна провисеть у экрана, прежде чем просить ссылку. */
const NEAR_DWELL_MS = 150

/**
 * Плитка подошла к видимой части колонки (с запасом в полтора ряда) и задержалась там —
 * один раз, дальше флаг не сбрасывается. Выдержка отсекает плитки, мимо которых пролистали
 * рывком: иначе быстрая прокрутка сетки до низа выбирала бы лимит API за секунды.
 */
export function useNearView<T extends Element>(
  dwellMs = NEAR_DWELL_MS,
): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!node || near) return
    // Без IntersectionObserver (jsdom, старый движок) грузим сразу: лучше лишний запрос,
    // чем вечно пустая плитка.
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    let timer: number | undefined
    const io = new IntersectionObserver(
      (entries) => {
        const inside = entries.some((e) => e.isIntersecting)
        window.clearTimeout(timer)
        if (inside) timer = window.setTimeout(() => setNear(true), dwellMs)
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(node)
    return () => {
      window.clearTimeout(timer)
      io.disconnect()
    }
  }, [node, near, dwellMs])
  return [setNode, near]
}

const DAY_MS = 86_400_000
/** Сколько дней назад дата ещё подписывается днём недели («ср 15:42»), как в Telegram. */
const WEEKDAY_WINDOW_DAYS = 6

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Дата файла, трека или ссылки — как подпись документа в Telegram: «сегодня в 15:42»,
 * «вчера в 09:10», на этой неделе — «ср 15:42», раньше — «12 нояб. 15:42», прошлый год —
 * с годом. `atTime` склеивает относительный день и время по правилам языка.
 */
export function sharedItemDate(
  iso: string,
  locale: string,
  atTime: (day: string, time: string) => string,
  now: Date = new Date(),
): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS)
  if (dayDiff <= 1) {
    // Будущее (часы устройства отстают от сервера) — тоже «сегодня».
    const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    return atTime(rel.format(dayDiff <= 0 ? 0 : -1, 'day'), time)
  }
  if (dayDiff <= WEEKDAY_WINDOW_DAYS) {
    return `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
  }
  const day = d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
  return `${day} ${time}`
}

/** Длительность видео на плитке: «0:15», «12:04». */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Чем показать видео в сетке. Есть постер медиа-системы — картинкой. Нет, но браузер умеет
 * формат — первым кадром самого ролика. Не умеет (`.mov` в Chrome и Firefox) — честной
 * заглушкой «видео» без запроса ссылки: `<video>` такого файла остаётся чёрным квадратом.
 */
export function videoTileMode(
  item: Pick<ChatMediaItem, 'mime' | 'hasPoster'>,
  canPlay: (mime: string) => boolean,
): 'poster' | 'frame' | 'stub' {
  if (item.hasPoster) return 'poster'
  return canPlay(item.mime) ? 'frame' : 'stub'
}

const playable = new Map<string, boolean>()
function canPlayVideo(mime: string): boolean {
  if (typeof document === 'undefined') return false
  let ok = playable.get(mime)
  if (ok === undefined) {
    ok = document.createElement('video').canPlayType(mime) !== ''
    playable.set(mime, ok)
  }
  return ok
}

// Пустая вкладка — компактно, как в Telegram: значок и строка по центру под вкладками, а не
// пунктирная рамка во всю колонку (она читалась как ошибка вёрстки).
export function TabEmpty({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return <ManageEmpty icon={Icon} title={title} />
}

// Ошибка загрузки вкладки: сообщение и «Повторить» (FRONTEND_RULES §9).
export function TabError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  return (
    <ManageEmpty
      icon={RotateCcw}
      title={t('sharedLoadError')}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          {tCommon('retry')}
        </Button>
      }
    />
  )
}

/** Заглушка списка: остров со строками той же геометрии, что у файлов и аудио. */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="mx-3 mb-3 overflow-hidden rounded-xl bg-card p-1.5 ring-1 ring-foreground/10"
      aria-hidden
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-1.5">
          <Skeleton className="size-12 shrink-0 rounded-lg" />
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
/**
 * Подпись на плитке — как у Telegram: длительность видео в левом верхнем углу на тёмной
 * полупрозрачной плашке. Подложка медиа не зависит от темы (DESIGN_SYSTEM §2.2), поэтому
 * белый текст на ней допустим.
 */
const TILE_BADGE =
  'absolute top-1 left-1 z-10 rounded-md bg-black/45 px-1.5 text-xs leading-[1.125rem] font-medium tabular-nums text-white'

/** Видео без кадра: спокойная плитка со значком «▶», а не чёрный квадрат. */
function VideoStub() {
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-muted" aria-hidden>
      <span className="flex size-10 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
        <Play className="ml-0.5 size-5 fill-current" />
      </span>
    </span>
  )
}

function MediaThumb({ item, onOpen }: { item: ChatMediaItem; onOpen: () => void }) {
  const t = useTranslations('Chats')
  const isVideo = item.mime.startsWith('video/')
  const mode = isVideo ? videoTileMode(item, canPlayVideo) : 'image'
  const [ref, near] = useNearView<HTMLButtonElement>()
  // Заглушке ссылка не нужна: кадра всё равно не будет, а запрос съел бы лимит API.
  const link = useFileLink(item.id, near && mode !== 'stub')
  // Кадр ролика без постера: пока его нет (и если не будет) — видна заглушка.
  const [frame, setFrame] = useState<'wait' | 'ready' | 'none'>('wait')
  const [durationMs, setDurationMs] = useState(item.durationMs ?? null)
  // Миниатюра сетки — копия 320 (или постер видео), а не оригинал: вкладка показывает
  // десятки снимков разом. Нет копий — оригинал.
  const poster = link.data?.poster ?? []
  const failed = link.isError && !link.data
  return (
    <button
      ref={ref}
      type="button"
      // Ссылку не дали (лимит, сеть) — нажатие просит её снова, а не открывает пустоту.
      onClick={failed ? () => void link.refetch() : onOpen}
      aria-label={failed ? t('sharedLoadError') : t('tgRight.openMedia')}
      // Плитка — точка, из которой просмотрщик вырастает и в которую садится.
      data-media-origin={item.id}
      className="relative aspect-square cursor-pointer overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {item.placeholder ? (
        <MediaImage
          media={{ placeholder: item.placeholder }}
          alt=""
          className="absolute inset-0 size-full"
        />
      ) : (
        (mode === 'stub' || mode === 'frame') && <VideoStub />
      )}
      {link.data && mode === 'frame' && frame !== 'none' && (
        // Первый кадр — самим роликом: `#t` просит браузер показать кадр, а не чёрное поле.
        <video
          src={`${link.data.url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          tabIndex={-1}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (!durationMs && Number.isFinite(d) && d > 0) setDurationMs(d * 1000)
          }}
          // Звуковая дорожка без видимого кадра (кодек не тот) — ширина кадра нулевая.
          onLoadedData={(e) => setFrame(e.currentTarget.videoWidth > 0 ? 'ready' : 'none')}
          onError={() => setFrame('none')}
          className={cn(
            'absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-(--motion-micro)',
            frame === 'ready' && 'opacity-100',
          )}
        />
      )}
      {link.data && (mode === 'image' || mode === 'poster') && (
        <MediaImage
          src={mode === 'poster' ? poster[poster.length - 1]?.url : link.data.url}
          media={{
            placeholder: item.placeholder,
            sources: mode === 'poster' ? poster : link.data.sources,
            width: mode === 'poster' ? null : item.width,
          }}
          alt=""
          sizes="140px"
          className="absolute inset-0 size-full"
        />
      )}
      {!link.data && (mode === 'image' || mode === 'poster') && !item.placeholder && !failed && (
        <span className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
      )}
      {failed && (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <RotateCcw className="size-5" aria-hidden />
        </span>
      )}
      {/* Видео отличается от снимка длительностью в углу, как в Telegram: значок «▶»
          поверх каждой второй плитки превращал сетку в стену кнопок. */}
      {isVideo && durationMs ? (
        <span className={TILE_BADGE}>{formatDuration(durationMs)}</span>
      ) : null}
    </button>
  )
}

export function MediaTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const [viewer, setViewer] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const q = useMediaPages(chatId, 'media')
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <GridSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0 && !q.hasNextPage)
    return <TabEmpty icon={ImageIcon} title={t('tgRight.emptyMedia')} />
  // Просмотрщик листает все медиа чата по времени (старые слева), как из ленты: сетка идёт
  // от свежих, поэтому кадры открытия — в обратном порядке. Шапка ведёт к сообщению кадра.
  const byTime = [...items].reverse()
  return (
    <>
      <div ref={gridRef} className="grid grid-cols-3 gap-px">
        {items.map((it) => (
          <MediaThumb key={it.id} item={it} onOpen={() => setViewer(it.id)} />
        ))}
      </div>
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
      {viewer !== null && (
        <ChatMediaRailViewer
          rail={{ chatId, actions: { focus: onJump } }}
          start={{
            items: byTime,
            index: Math.max(
              0,
              byTime.findIndex((it) => it.id === viewer),
            ),
          }}
          originOf={(id) =>
            gridRef.current?.querySelector<HTMLElement>(
              `[data-media-origin="${CSS.escape(id)}"]`,
            ) ?? null
          }
          onClose={() => setViewer(null)}
        />
      )}
    </>
  )
}

/**
 * Остров списка — та же поверхность, что у карточки сведений над вкладками (InfoCard):
 * файлы, ссылки, музыка, голосовые и опросы в Telegram лежат на такой же карточке.
 */
function ListIsland({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-xl bg-card p-1.5 ring-1 ring-foreground/10">
      {children}
    </div>
  )
}

/** «{день} в {время}» на языке интерфейса — для подписи даты в строках вкладок. */
function useSharedDate(): (iso: string) => string {
  const t = useTranslations('Chats')
  const locale = useLocale()
  return (iso) => sharedItemDate(iso, locale, (day, time) => t('tgRight.dateAtTime', { day, time }))
}

// ── Файлы: список ───────────────────────────────────────────────────────────
/**
 * Файл — как документ в Telegram: значок расширения и есть кнопка скачивания (под курсором
 * на нём появляется «↓», во время загрузки — кольцо с «×», готовый файл — «сохранить»), а
 * нажатие на имя ведёт к сообщению в переписке.
 */
function FileRow({ item, onJump }: { item: ChatMediaItem; onJump: (id: string) => void }) {
  const unit = useByteUnitLabel()
  const t = useTranslations('Chats')
  const dateOf = useSharedDate()
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
  const busy = state.status === 'loading'
  return (
    <div className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-muted/40">
      <button
        type="button"
        aria-label={
          busy ? t('downloadCancel') : state.status === 'ready' ? t('save') : t('download')
        }
        title={state.status === 'error' ? t('downloadFailed') : undefined}
        onClick={download.toggle}
        className="group/icon relative size-12 shrink-0 overflow-hidden rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
      >
        {/* Тот же значок расширения, что в ленте: один и тот же файл нельзя показывать
            двумя разными способами в двух местах одного экрана. */}
        <span
          className={cn('flex size-full items-center justify-center text-white', kind.className)}
        >
          {kind.ext ? (
            <span className="text-[0.6875rem] font-bold uppercase leading-none tracking-tight">
              {kind.ext}
            </span>
          ) : (
            <FileText className="size-5" aria-hidden />
          )}
        </span>
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity duration-(--motion-micro)',
            busy || state.status === 'error'
              ? 'opacity-100'
              : 'opacity-0 group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100',
          )}
        >
          {busy ? (
            <>
              <X className="size-4" strokeWidth={2.5} aria-hidden />
              <ProgressRing progress={download.progress} className="text-white" />
            </>
          ) : state.status === 'ready' ? (
            <Save className="size-5" aria-hidden />
          ) : state.status === 'error' ? (
            <RotateCcw className="size-5" aria-hidden />
          ) : (
            <Download className="size-5" aria-hidden />
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onJump(item.messageId)}
        className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="block truncate text-[0.9375rem] font-medium">
          {item.name ?? t('attachment')}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {formatBytes(item.size, unit)} · {dateOf(item.createdAt)}
        </span>
      </button>
    </div>
  )
}

/**
 * Голосовые и музыка правой панели — очередь общего аудиоплеера (entities/chat, тот же звук,
 * что у ленты): запуск отсюда останавливает играющее в ленте и наоборот, панель под шапкой
 * чата показывает трек, автопереход идёт вниз по списку, скорость — общая запомненная.
 *
 * Строки — как аудио в общих материалах Telegram: у музыки название и «длительность ·
 * исполнитель · дата», у голосового — автор с датой справа и длительность под ним.
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
  const dateOf = useSharedDate()
  const player = useAudioPlayer()
  const music = type === 'music'
  const toggle = usePlaylistQueue(`panel:${chatId}:${type}`, chatId, items, t('attachment'))

  return (
    <>
      {items.map((it) => {
        const active = player.track?.id === it.id
        const playing = active && player.playing
        const author = it.sender ? `${it.sender.lastName} ${it.sender.firstName}`.trim() : null
        const length = it.durationMs ? formatDuration(it.durationMs) : formatBytes(it.size, unit)
        return (
          <div
            key={it.id}
            className={cn(
              'flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-muted/40',
              active && 'bg-primary/5',
            )}
          >
            <button
              type="button"
              aria-label={playing ? t('pause') : t('play')}
              onClick={() => toggle(it.id)}
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-ring/20"
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
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium">
                  {music ? (it.name ?? t('attachment')) : (author ?? t('attachment'))}
                </span>
                {!music && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {chatListTime(it.createdAt, locale)}
                  </span>
                )}
              </span>
              <span className="block truncate text-sm text-muted-foreground tabular-nums">
                {music
                  ? [length, author, dateOf(it.createdAt)].filter(Boolean).join(' · ')
                  : length}
              </span>
              {/* Полоса прогресса только у играющей записи — у остальных она была бы шумом. */}
              {active && <PlaylistProgress playing={player.playing} duration={player.duration} />}
            </button>
            {/* Скорость — у голосовых и длинных записей; песня играет на обычной. */}
            {active && (!music || player.duration >= LONG_AUDIO_SEC) && <VoiceRateButton />}
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
const FILE_TAB = {
  file: { icon: FileText, empty: 'tgRight.emptyFiles' },
  voice_note: { icon: Mic, empty: 'tgRight.emptyVoice' },
  music: { icon: Music, empty: 'tgRight.emptyMusic' },
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
    const { icon, empty } = FILE_TAB[type]
    return <TabEmpty icon={icon} title={t(empty)} />
  }
  return (
    <ListIsland>
      {type !== 'file' ? (
        <VoicePlaylist chatId={chatId} type={type} items={items} onJump={onJump} locale={locale} />
      ) : (
        items.map((it) => <FileRow key={it.id} item={it} onJump={onJump} />)
      )}
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
    </ListIsland>
  )
}

// ── Опросы: список, клик — к опросу в переписке ──────────────────────────────
function PollRow({ message, onJump }: { message: ChatMessage; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const dateOf = useSharedDate()
  const poll = message.poll
  if (!poll) return null
  const author = `${message.sender.lastName} ${message.sender.firstName}`
  return (
    <button
      type="button"
      onClick={() => onJump(message.id)}
      className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <BarChart3 className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium">{poll.question}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {poll.closed && `${t('pollClosed')} · `}
          {author} · {dateOf(message.createdAt)}
        </span>
      </span>
    </button>
  )
}

export function PollsTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const q = useInfiniteQuery({
    queryKey: chatKeys.polls(chatId),
    queryFn: ({ pageParam }) => fetchChatPolls(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <RowsSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0) return <TabEmpty icon={BarChart3} title={t('tgRight.emptyPolls')} />
  return (
    <ListIsland>
      {items.map((m) => (
        <PollRow key={m.id} message={m} onJump={onJump} />
      ))}
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
    </ListIsland>
  )
}

// ── Ссылки: список ───────────────────────────────────────────────────────────
/** Адрес ссылки для подписи: без схемы и хвостового «/», как в Telegram. */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')
}

/**
 * Ссылка — как в общих материалах Telegram: слева картинка превью (нет её — первая буква
 * сайта в квадрате), справа заголовок, две строки описания и сам адрес. Нажатие на строку
 * ведёт к сообщению, на адрес — открывает сайт в новой вкладке.
 */
function LinkRow({ item, onJump }: { item: ChatLinkItem; onJump: (id: string) => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  const lp = item.linkPreview
  if (!lp) return null
  let host = lp.url
  try {
    host = new URL(lp.url).hostname.replace(/^www\./, '')
  } catch {
    /* оставляем как есть */
  }
  const jump = (): void => onJump(item.messageId)
  return (
    // Вся строка ведёт к сообщению (мышью); с клавиатуры — кнопка заголовка внутри.
    <div
      onClick={jump}
      className="flex cursor-pointer items-start gap-3 rounded-lg p-1.5 transition-colors hover:bg-muted/40"
    >
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-xl font-medium uppercase text-primary">
        {lp.image && !imageFailed ? (
          // Внешняя картинка превью — обычный img: домен произвольный, next/image не подходит.
          <img
            src={lp.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          host.charAt(0) || <Link2 className="size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            jump()
          }}
          className="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="line-clamp-2 text-[0.9375rem] font-medium break-words">
            {lp.title || lp.siteName || host}
          </span>
          {lp.description && (
            <span className="mt-0.5 line-clamp-2 text-sm text-muted-foreground break-words">
              {lp.description}
            </span>
          )}
        </button>
        {/* Адрес открывает сайт, а не сообщение: отдельная ссылка под текстом. */}
        <a
          href={lp.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 block truncate rounded-sm text-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {displayUrl(lp.url)}
        </a>
      </span>
    </div>
  )
}

export function LinksTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const q = useInfiniteQuery({
    queryKey: chatKeys.links(chatId),
    queryFn: ({ pageParam }) => fetchChatLinks(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <RowsSkeleton />
  if (q.isError && items.length === 0) return <TabError onRetry={() => void q.refetch()} />
  if (items.length === 0) return <TabEmpty icon={Link2} title={t('tgRight.emptyLinks')} />
  return (
    <ListIsland>
      {items.map((it) => (
        <LinkRow key={it.messageId} item={it} onJump={onJump} />
      ))}
      <PageSentinel
        hasNext={q.hasNextPage}
        loading={q.isFetchingNextPage}
        failed={q.isFetchNextPageError}
        onLoad={() => void q.fetchNextPage()}
      />
    </ListIsland>
  )
}
