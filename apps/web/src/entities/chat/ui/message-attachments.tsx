'use client'

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowDown, Check, FileText, Loader2, Play, RotateCw, X } from 'lucide-react'
import {
  formatBytes,
  formatBytesProgress,
  pickSource,
  srcSetOf,
  useByteUnitLabel,
  useFileDownload,
} from '../../../shared/lib'
import { ProgressRing } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useAttachmentLinkSource, useMediaNear } from './attachment-link-source'
import { fileKind } from '../lib/file-kind'
// Те же признаки вида, что у превью в списке чатов, — один источник на оба места.
import { isAnimation, isMusic, isVideoNote, isViewable, isVoice } from '../lib/attachment-kind'
import { GifVideo } from './gif-video'
import { albumLayout } from '../lib/album-layout'
import type { ChatMediaItem, MessageAttachment } from '../model/types'
import type { MediaLink } from '../../../shared/api'
import { VoiceMessage, type VoiceTrackMeta } from './voice-message'
import { MusicMessage } from './music-message'
import { isVoiceRecording } from '../lib/audio-player'
import { MediaViewer, type MediaViewerActions, type MediaViewerMeta } from './media-viewer'
import { ChatMediaRailViewer, type ChatMediaRailContext } from './chat-media-rail-viewer'
import { RoundVideo } from './round-video'

// Голосовое сообщение (плеер-волна), а не обычное аудио/видео вложение.
/** `0:55`, `1:02:30` — длительность ролика бейджем в углу кадра, как в Telegram. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** Бейдж длительности: одинаковый в одиночном кадре и в ячейке альбома. */
function DurationBadge({ seconds }: { seconds: number | null }) {
  if (seconds == null) return null
  return (
    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
      {formatDuration(seconds)}
    </span>
  )
}

/**
 * Автозагрузка медиа, как в Telegram: ролик до этого веса скачивается сам, как только
 * долистали до него, — и просмотрщик открывает его мгновенно из памяти. Крупнее — по кнопке,
 * чтобы не съедать трафик за человека. В режиме экономии трафика автозагрузки нет.
 */
const AUTO_VIDEO_BYTES = 20 * 1024 * 1024

function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return c?.saveData === true
}

/** Элемент подошёл к экрану (с запасом в полэкрана) — один раз, дальше не следим. */
function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '50% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return [ref, near]
}

/**
 * Снимок у экрана — заранее грузим ту копию, которую возьмёт просмотрщик (srcset под всю
 * ширину экрана): открытие тогда мгновенное, без размытой заглушки и ожидания. Кнопки
 * «скачать» у снимков в ленте нет — сохранить можно из просмотрщика.
 */
function ImagePrewarm({ url, link }: { url: string; link: MediaLink | undefined }) {
  const [ref, near] = useNearViewport<HTMLSpanElement>()
  useEffect(() => {
    if (!near) return
    const img = new Image()
    img.sizes = '100vw'
    const srcset = srcSetOf(link?.sources, { url, width: link?.width })
    if (srcset) img.srcset = srcset
    img.src = url
  }, [near, url, link])
  return <span ref={ref} className="pointer-events-none absolute inset-0" aria-hidden />
}

/**
 * Скачать снимок в приложение — кругом посреди кадра, как в Telegram: «↓» с весом под ним →
 * кольцо с «×» и мегабайтами → «✓ Сохранить». Нажатие на сам кадр по-прежнему открывает
 * просмотрщик; круг — отдельная кнопка и клик до кадра не пропускает.
 *
 * Посреди кадра, а не в углу: там же показываются отправка и повтор упавшей, и все состояния
 * вложения читаются в одной точке, а не по очереди в разных углах.
 *
 * У ролика середину занимает кнопка воспроизведения — там кнопка уходит в угол плашкой
 * (`corner`): два круга в одной точке наложились бы друг на друга.
 *
 * Ключ тот же, что у строки файла и у «Скачать» в просмотрщике (`file:<id>`): начатое в
 * одном месте видно в остальных. В маленькой ячейке альбома — только круг, подпись уходит
 * в подсказку и в aria-label.
 */
function MediaDownloadPill({
  att,
  url,
  compact = false,
  corner = false,
  auto = false,
}: {
  att: MessageAttachment
  url: string
  compact?: boolean
  /** Середина кадра занята (ролик) — кнопка встаёт плашкой в правый верхний угол. */
  corner?: boolean
  /**
   * Скачать само, когда долистали (AUTO_VIDEO_BYTES): кнопки «↓» нет, виден только прогресс,
   * а готовое — без плашки вовсе (сохранить можно из просмотрщика).
   */
  auto?: boolean
}) {
  const t = useTranslations('Chats')
  const unit = useByteUnitLabel()
  const download = useFileDownload(`file:${att.id ?? 'pending'}`, {
    url,
    name: att.name || t('attachment'),
    mime: att.mime,
  })
  const dl = download.state
  const [nearRef, near] = useNearViewport<HTMLSpanElement>()
  const startDownload = download.start
  useEffect(() => {
    if (auto && near && dl.status === 'idle' && !saveData()) startDownload()
    // startDownload пересоздаётся каждым рендером; запуск нужен по факту «подошли к экрану».
  }, [auto, near, dl.status])
  const loading = dl.status === 'loading'
  const label = loading
    ? formatBytesProgress(dl.loaded, dl.total ?? att.size, unit)
    : dl.status === 'ready'
      ? t('save')
      : dl.status === 'error'
        ? t('downloadFailed')
        : formatBytes(att.size, unit)
  const ariaLabel = loading
    ? t('downloadCancel')
    : dl.status === 'ready'
      ? t('save')
      : t('download')
  // Значок один и тот же в обоих размещениях — меняется только его размер.
  const icon = loading ? (
    <>
      <X className={corner ? 'size-3' : 'size-5'} strokeWidth={3} aria-hidden />
      <ProgressRing progress={download.progress} />
    </>
  ) : dl.status === 'ready' ? (
    <Check className={corner ? 'size-3.5' : 'size-5'} strokeWidth={3} aria-hidden />
  ) : (
    <ArrowDown className={corner ? 'size-3.5' : 'size-5'} strokeWidth={3} aria-hidden />
  )
  // Нажатие до кадра не пропускаем: под кнопкой лежит открывашка просмотрщика во весь кадр.
  const start = (e: ReactMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    download.toggle()
  }

  // Автозагрузка: в покое и готовым — только невидимый датчик «подошли к экрану».
  if (auto && (dl.status === 'idle' || dl.status === 'ready')) {
    return <span ref={nearRef} className="pointer-events-none absolute inset-0" aria-hidden />
  }

  if (corner) {
    return (
      <button
        type="button"
        onClick={start}
        aria-label={ariaLabel}
        title={compact ? label : undefined}
        className={cn(
          'absolute top-1.5 right-1.5 z-10 flex cursor-pointer items-center gap-1 rounded-full bg-black/55 py-0.5 pl-0.5 text-[0.7rem] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/70',
          compact ? 'pr-0.5' : 'pr-2',
          dl.status === 'error' && 'bg-destructive/80 hover:bg-destructive',
        )}
      >
        <span className="relative flex size-5 shrink-0 items-center justify-center">{icon}</span>
        {!compact && <span className="max-w-40 truncate tabular-nums">{label}</span>}
      </button>
    )
  }

  return (
    // Слой нажатий не ловит — их ловит только сама кнопка: остальной кадр по-прежнему
    // открывает просмотрщик, хотя слой и растянут на него целиком.
    <span className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={start}
        aria-label={ariaLabel}
        title={label}
        className={cn(
          MEDIA_CIRCLE,
          'pointer-events-auto relative cursor-pointer transition-[background-color,transform] hover:bg-black/75 active:scale-90',
          // В ячейке альбома круг мельче: кадр там со спичечный коробок, и полный размер
          // закрывал бы его почти целиком.
          compact && 'size-10',
          dl.status === 'error' && 'bg-destructive/80 hover:bg-destructive',
        )}
      >
        {icon}
      </button>
      {/* Вес файла — подписью под кругом, как в Telegram. В ячейке альбома места под неё
          нет, там он остаётся в подсказке и у экранного диктора. */}
      {!compact && (
        <span className="max-w-[85%] truncate rounded-full bg-black/55 px-2 py-0.5 text-[0.7rem] font-medium tabular-nums text-white backdrop-blur-sm">
          {label}
        </span>
      )}
    </span>
  )
}

// Запасное место под снимок, когда размеров нет (видео, вложения старше полей width/height):
// усреднённый прямоугольник. Без него пузырь схлопывается в ноль, а потом прыгает на всю
// высоту картинки, и на медленной сети в нём зияет пустой цветной прямоугольник.
const MEDIA_BOX = 'h-40 w-56 max-w-full'
// Потолок высоты медиа в пузыре — тот же max-h-64, что и у самой картинки.
const MEDIA_MAX_H = 256
// Заглушка/подложка читается и на синем «своём» пузыре, и на сером чужом.
const MEDIA_TINT = 'bg-foreground/10'
// Круг посреди кадра — один и тот же у отправки, у ошибки и у скачивания, как в Telegram:
// «едет», «не доехало» и «сохранить» читаются одним элементом в одной точке кадра.
const MEDIA_CIRCLE = 'flex size-12 items-center justify-center rounded-full bg-black/55 text-white'

// Коробка будущего снимка. Есть размеры с сервера — повторяем ровно ту, которую займёт
// картинка: ширина по пузырю (max-w-full), высота по пропорции и потолку max-h-64.
// Нет размеров (видео, вложения старше полей) — усреднённая заглушка.
function frameProps(att: MessageAttachment): { className: string; style?: CSSProperties } {
  if (!att.width || !att.height) return { className: MEDIA_BOX }
  const scale = Math.min(1, MEDIA_MAX_H / att.height)
  return {
    className: 'max-w-full',
    style: { width: Math.round(att.width * scale), aspectRatio: `${att.width} / ${att.height}` },
  }
}

// presigned-URL живёт 15 мин — кэшируем 10, чтобы не дёргать API на каждый ререндер.
// Для оптимистичных (ещё не отправленных) вложений с localUrl запрос не делаем.
function useAttachmentUrl(att: MessageAttachment) {
  const hasLocal = !!att.localUrl
  const source = useAttachmentLinkSource()
  // Строка ещё далеко от кадра — ссылку не просим (см. MediaNearProvider). Уже полученная
  // остаётся в кэше и показывается сразу.
  const near = useMediaNear()
  const q = useQuery({
    queryKey: [source.scope, att.id],
    queryFn: () => source.fetch(att.id),
    enabled: !hasLocal && near,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  return {
    url: att.localUrl ?? q.data?.url,
    // Варианты медиа-системы: копии для srcset, постер видео. У локального файла их нет.
    link: hasLocal ? undefined : q.data,
    isLoading: !hasLocal && q.isPending,
    isError: !hasLocal && q.isError,
    // Ссылка живёт 15 мин: и «не пришла», и «протухла» лечатся повторным запросом.
    refetch: () => void q.refetch(),
  }
}

// Ошибка вместо медиа (FRONTEND_RULES §13: у асинхронного состояния есть error с «Повторить»).
// Раньше и не пришедшая ссылка, и битый файл крутили спиннер бесконечно.
function MediaFailed({
  className,
  onRetry,
  reason = 'load',
}: {
  className?: string
  onRetry: () => void
  /** Что именно не получилось: скачать кадр или отправить его. Круг один, подпись разная. */
  reason?: 'load' | 'send'
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  // Текст ушёл в подпись кнопки: на кадре Telegram показывает только круг, а экранному
  // диктору по-прежнему нужно сказать, что случилось и что сделает нажатие.
  const label = `${reason === 'send' ? t('uploadFailed') : t('mediaFailed')} — ${tCommon('retry')}`
  return (
    <span
      className={cn(
        'flex min-h-20 items-center justify-center overflow-hidden rounded-lg',
        MEDIA_TINT,
        className,
      )}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          // Всплытие гасим: заглушка живёт внутри пузыря, у которого свои нажатия
          // (выделение сообщения, открытие просмотрщика у соседних вложений).
          e.preventDefault()
          e.stopPropagation()
          onRetry()
        }}
        className={cn(
          MEDIA_CIRCLE,
          'cursor-pointer transition-colors hover:bg-black/75 active:scale-90',
        )}
      >
        <RotateCw className="size-6" aria-hidden />
      </button>
    </span>
  )
}

/**
 * Полупрозрачный оверлей загрузки поверх медиа (Telegram-стиль): затемнение, прогресс и отмена.
 *
 * Отмена — не украшение: сорокамегабайтный ролик, улетевший не в тот чат, иначе нечем
 * остановить, и пользователь смотрит, как он доезжает. Крестик поверх круга, как в Telegram.
 */
function MediaUploadOverlay({ progress, onCancel }: { progress?: number; onCancel?: () => void }) {
  const t = useTranslations('Chats')
  const pct = Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)
  const content = onCancel ? (
    <X className="size-6" aria-hidden />
  ) : pct > 0 ? (
    <span className="text-xs font-medium tabular-nums">{pct}%</span>
  ) : (
    <Loader2 className="size-6 animate-spin" aria-hidden />
  )
  return (
    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
      {onCancel ? (
        <button
          type="button"
          aria-label={t('cancelUpload')}
          title={t('cancelUpload')}
          onClick={(e) => {
            // Оверлей лежит на кнопке-открывашке просмотрщика: без остановки всплытия
            // отмена заодно открывала бы полноэкранный просмотр отменённого снимка.
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }}
          className={cn(
            MEDIA_CIRCLE,
            'relative cursor-pointer transition-colors hover:bg-black/75',
          )}
        >
          {/* Кольцо прогресса вокруг крестика: сколько уже ушло, видно и при наведении. */}
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(currentColor ${pct * 3.6}deg, transparent 0deg)`,
              opacity: 0.35,
            }}
          />
          {content}
        </button>
      ) : (
        <span className={MEDIA_CIRCLE}>{content}</span>
      )}
    </span>
  )
}

// LQIP-заглушка медиа-системы: размытый силуэт снимка, пока не пришли байты. Приходит в
// списке сообщений, поэтому видна раньше даже запроса за ссылкой. Нет — заливка, как раньше.
function Lqip({ src, className }: { src?: string | null; className?: string }) {
  if (!src) return <span className={cn('absolute inset-0', MEDIA_TINT, className)} aria-hidden />
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('absolute inset-0 size-full scale-110 object-cover blur-lg', className)}
    />
  )
}

// Ширина снимка в пузыре для `sizes`: браузер по ней выбирает копию (на ретине — вдвое шире).
// На узком экране пузырь сам уже ширины кадра, отсюда 80vw.
function bubbleSizes(att: MessageAttachment): string {
  const frame = frameProps(att)
  const width = typeof frame.style?.width === 'number' ? frame.style.width : 224
  return `(max-width: 480px) 80vw, ${width}px`
}

/** Подпись «GIF» в углу кадра — у пузыря и у ячейки альбома одна. */
function GifBadge() {
  const t = useTranslations('Chats')
  return (
    <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[0.6rem] font-semibold uppercase text-white">
      {t('tgGifs.badge')}
    </span>
  )
}

/** Сервер перевёл GIF в MP4 — по флагу вложения или, если сообщение старше перевода, по ссылке. */
function isAnimatedNow(att: MessageAttachment, link: MediaLink | undefined): boolean {
  // Свой только что отправленный GIF играет из локального файла — а это сам GIF, не MP4.
  if (att.asDocument || att.localUrl) return false
  if (isAnimation(att)) return true
  return !!link?.animation && (link.mime ?? '').startsWith('video/')
}

/**
 * GIF в пузыре как в Telegram: беззвучный MP4 играет сам и по кругу, без кнопки ▶, длительности
 * и панели плеера; в углу — «GIF». Нажатие открывает просмотрщик, где он тоже крутится.
 */
function AnimationFrame({
  att,
  url,
  link,
  uploading,
  onOpen,
  onCancel,
  onBroken,
}: {
  att: MessageAttachment
  url: string
  link: MediaLink | undefined
  uploading: boolean
  onOpen?: () => void
  onCancel?: () => void
  onBroken: () => void
}) {
  const t = useTranslations('Chats')
  const [painted, setPainted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const blurred = !!att.spoiler && !revealed
  // Размеры MP4 — из ссылки: у сообщения, разосланного до перевода, они от GIF (та же пропорция).
  const width = link?.width ?? att.width
  const height = link?.height ?? att.height
  const sized = !!width && !!height
  const frame = frameProps({ ...att, width, height })
  const poster = pickSource(link?.poster, 640)?.url
  return (
    <div
      data-media-origin={att.id}
      className={cn(
        'relative block w-fit max-w-full overflow-hidden rounded-lg',
        sized ? frame.className : cn(MEDIA_BOX, MEDIA_TINT),
      )}
      style={sized ? frame.style : undefined}
    >
      <GifVideo
        src={url}
        poster={poster}
        paused={blurred || uploading}
        onReady={() => setPainted(true)}
        onError={onBroken}
        className={cn(
          'block transition-opacity duration-200',
          sized ? 'size-full object-cover' : 'max-h-64 max-w-full',
          !painted && 'opacity-0',
          blurred && 'scale-105 blur-xl',
        )}
      />
      {!painted && <Lqip src={att.placeholder ?? link?.placeholder} />}
      {uploading ? (
        <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />
      ) : blurred ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex cursor-pointer items-center justify-center text-xs font-semibold uppercase tracking-wide text-white"
        >
          {t('spoiler')}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={onOpen}
            aria-label={t('tgGifs.open')}
            className="absolute inset-0 cursor-pointer"
          />
          <GifBadge />
        </>
      )}
    </div>
  )
}

function Single({
  att,
  mine,
  onOpen,
  onCancel,
  sendFailed: messageFailed,
  onRetry,
  audioMeta,
}: {
  att: MessageAttachment
  mine: boolean
  onOpen?: () => void
  /** Подписи голосового или песни для панели аудиоплеера: автор, когда, «к сообщению». */
  audioMeta?: VoiceTrackMeta
  /** Прервать загрузку этого сообщения (крестик в оверлее). Нет — отменять нечего. */
  onCancel?: () => void
  /** Сообщение не ушло: отправка упала и сама уже не возобновится. */
  sendFailed?: boolean
  /** Повторить отправку всего сообщения — вложения уходят вместе с ним. */
  onRetry?: () => void
}) {
  const t = useTranslations('Chats')
  const unit = useByteUnitLabel()
  // Длительность ролика: читаем у того же элемента, что уже тянет первый кадр.
  const [duration, setDuration] = useState<number | null>(null)
  const { url, link, isLoading, isError, refetch } = useAttachmentUrl(att)
  // Упавшая отправка — это НЕ «грузится». Раньше здесь стоял просто `att.uploading`, и у
  // не ушедшего сообщения вложения навсегда замирали со спиннером на «0 / 312.8 МБ»:
  // сам он сдвинуться не мог, отменить из строки файла было нечем, повторить — тоже.
  // У сообщения при этом уже стояла красная метка «не отправлено», то есть пузырь про
  // беду знал, а вложения внутри него — нет.
  const sendFailed = !!messageFailed && !!att.uploading
  const uploading = !!att.uploading && !messageFailed
  // Скачивание файла внутри приложения (shared/lib/file-download): ключ — id файла, тот же,
  // что у вкладки «Файлы», — начатое там видно здесь, и наоборот.
  const download = useFileDownload(`file:${att.id ?? 'pending'}`, {
    url: url ?? '',
    name: att.name || t('attachment'),
    mime: att.mime,
  })
  // Нажали на файл, ссылки на который ещё нет: спрашиваем её и качаем, как только пришла.
  const [fileWanted, setFileWanted] = useState(false)
  const startDownload = download.start
  useEffect(() => {
    if (!fileWanted || !url) return
    setFileWanted(false)
    startDownload()
    // startDownload пересоздаётся каждым рендером; запуск нужен по факту пришедшей ссылки.
  }, [fileWanted, url])
  // Ссылка так и не пришла (сеть, лимит запросов) — круг ожидания не висит вечно: через
  // 10 с значок возвращается, и нажатие можно повторить.
  useEffect(() => {
    if (!fileWanted) return
    const timer = setTimeout(() => setFileWanted(false), 10_000)
    return () => clearTimeout(timer)
  }, [fileWanted])
  const requestFile = (): void => {
    setFileWanted(true)
    refetch()
  }
  // Спойлер (§34): размыто до клика.
  const [revealed, setRevealed] = useState(false)
  const blurred = !!att.spoiler && !revealed
  // Пиксели снимка/кадра уже на экране: до этого держим скелетон, а не пустое место.
  const [painted, setPainted] = useState(false)
  // Сам файл не отрисовался (чаще всего протухшая ссылка) — показываем «Повторить».
  const [broken, setBroken] = useState(false)
  const kind = fileKind(att.name, att.mime)
  // Картинка и видео занимают место кадром, голосовые и файлы — узкой строкой.
  const framed = isViewable(att)

  // Не ушёл снимок или ролик — на его месте тот же круг повтора, что и у не скачавшегося:
  // для глаза это одно и то же «нажми, чтобы ещё раз», и разводить два вида незачем.
  if (sendFailed && framed) {
    return <MediaFailed className={MEDIA_BOX} reason="send" onRetry={() => onRetry?.()} />
  }

  // Строка файла, голосовое и песня ссылки не ждут: их вид от байтов не зависит, а ссылка
  // нужна только по нажатию. Раньше документ с подписью, чья ссылка не пришла (лимит
  // запросов, протухла), рисовался пустым серым кадром с кругом ↻, а пока ехала — полоской
  // h-10, которая потом вырастала в строку файла.
  if (framed && (isError || broken)) {
    return (
      <MediaFailed
        className={MEDIA_BOX}
        onRetry={() => {
          setBroken(false)
          setPainted(false)
          refetch()
        }}
      />
    )
  }

  if (framed && (isLoading || !url)) {
    // Пока едет presigned-ссылка, место под снимок уже знает его форму (если размеры есть).
    // Заливка без пульсации: мигающий прямоугольник посреди переписки притягивал взгляд
    // сильнее самих сообщений, а держать место надо — иначе лента прыгает под руками.
    // Есть LQIP — в этом месте сразу размытый силуэт снимка, а не пустая заливка.
    const frame = frameProps(att)
    return (
      <div
        className={cn('relative overflow-hidden rounded-lg', MEDIA_TINT, frame.className)}
        style={frame.style}
        aria-hidden
      >
        {att.placeholder && (
          <Lqip src={att.placeholder} className={blurred ? 'blur-xl' : undefined} />
        )}
      </div>
    )
  }

  if (isVoice(att)) {
    return (
      <span className={cn('relative inline-flex max-w-full', uploading && 'opacity-60')}>
        {isMusic(att) ? (
          <MusicMessage
            url={url}
            seed={att.id}
            name={att.name}
            size={att.size}
            durationMs={att.durationMs}
            mine={mine}
            meta={audioMeta}
          />
        ) : (
          <VoiceMessage
            url={url}
            seed={att.id}
            mine={mine}
            size={att.size}
            durationMs={att.durationMs}
            meta={audioMeta}
          />
        )}
        {uploading && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">
            <Loader2 className="size-4 animate-spin opacity-70" aria-hidden />
          </span>
        )}
      </span>
    )
  }

  if (!framed) {
    // Документ в стиле Telegram: значок-лист 54 px цвета типа файла с загнутым углом и
    // расширением, справа имя (16 px) и вес. Нажатие скачивает файл в приложение с прогрессом
    // на значке (второе нажатие — отмена), готовый — сохраняет на устройство. Ссылка не
    // нужна для показа: нет её (далеко от экрана, не пришла) — нажатие сначала спросит её.
    const dl = download.state
    const loading = dl.status === 'loading'
    const waiting = fileWanted && !loading
    return (
      <button
        type="button"
        // Упавшая отправка перехватывает нажатие: качать нечего — файл до сервера не доехал.
        onClick={sendFailed ? () => onRetry?.() : url ? download.toggle : requestFile}
        disabled={uploading}
        aria-label={
          sendFailed
            ? t('sendFailedRetry')
            : loading
              ? t('downloadCancel')
              : dl.status === 'ready'
                ? t('save')
                : t('download')
        }
        className="group/file flex min-w-[14rem] max-w-full cursor-pointer items-center gap-3 py-0.5 text-left disabled:cursor-default"
      >
        {/* Цвет задаёт тип документа (§7 карты): в переписке с десятком вложений он различает
            архив, таблицу и картинку раньше, чем прочитано имя. */}
        <span
          className={cn(
            'relative flex size-[3.375rem] shrink-0 items-end overflow-hidden rounded-md px-2 pb-1.5 text-white',
            // Загнутый угол листа: верхний правый срезан, под срезом — тень сгиба.
            '[clip-path:polygon(0_0,calc(100%-1.125rem)_0,100%_1.125rem,100%_100%,0_100%)]',
            uploading ? 'bg-muted-foreground' : kind.className,
          )}
        >
          <span
            aria-hidden
            className="absolute top-0 right-0 size-[1.125rem] rounded-bl-[0.25rem] bg-black/25"
          />
          {sendFailed || uploading || loading || waiting ? (
            <span className="absolute inset-0 flex items-center justify-center">
              {sendFailed ? (
                <RotateCw className="size-6" aria-hidden />
              ) : uploading || waiting ? (
                <Loader2 className="size-6 animate-spin" aria-hidden />
              ) : (
                <X className="size-5" strokeWidth={2.5} aria-hidden />
              )}
              {loading && <ProgressRing progress={download.progress} />}
            </span>
          ) : (
            <>
              {/* Расширение, а при наведении — что сделает нажатие, как в Telegram. */}
              <span className="text-sm leading-none font-semibold uppercase transition-opacity group-hover/file:opacity-0">
                {kind.ext || <FileText className="size-5" aria-hidden />}
              </span>
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/file:opacity-100">
                {dl.status === 'ready' ? (
                  <Check className="size-6" strokeWidth={2.5} aria-hidden />
                ) : dl.status === 'error' ? (
                  <RotateCw className="size-6" aria-hidden />
                ) : (
                  <ArrowDown className="size-6" strokeWidth={2.5} aria-hidden />
                )}
              </span>
            </>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-tight font-medium">
            {att.name || t('attachment')}
          </span>
          <span
            className={cn(
              'mt-0.5 block truncate text-sm leading-tight',
              mine ? 'opacity-70' : 'text-muted-foreground',
            )}
          >
            {/* Прогресс мегабайтами, а не процентами: «11.5 / 40.1 МБ» сразу говорит и сколько
                осталось, и сколько весит файл, — процент отвечает только на первое. */}
            {sendFailed ? (
              <span className={mine ? 'underline' : 'text-destructive'}>{t('uploadFailed')}</span>
            ) : uploading && att.progress != null ? (
              formatBytesProgress(att.progress * att.size, att.size, unit)
            ) : loading ? (
              formatBytesProgress(dl.loaded, dl.total ?? att.size, unit)
            ) : dl.status === 'ready' ? (
              <>
                {formatBytes(att.size, unit)} ·{' '}
                <span className={cn('font-semibold', mine ? 'underline' : 'text-primary')}>
                  {t('save')}
                </span>
              </>
            ) : dl.status === 'error' ? (
              <span className={mine ? 'underline' : 'text-destructive'}>{t('downloadFailed')}</span>
            ) : (
              formatBytes(att.size, unit)
            )}
          </span>
        </span>
      </button>
    )
  }

  // Сюда доходят только кадры, а их ссылка проверена выше.
  if (!url) return null

  if (isAnimatedNow(att, link)) {
    return (
      <AnimationFrame
        att={att}
        url={url}
        link={link}
        uploading={uploading}
        onOpen={onOpen}
        onCancel={onCancel}
        onBroken={() => setBroken(true)}
      />
    )
  }

  if (isViewable(att) && att.mime.startsWith('image/')) {
    // GIF (image/gif) автопроигрывается нативно как <img>; для остальных — lazy-загрузка (§30).
    const isGif = att.mime === 'image/gif'
    // Размеры с сервера: браузер по width/height считает пропорцию и держит место сам —
    // ровно то, которое займёт снимок. Тогда скелетон ложится точно по кадру и вёрстка
    // не прыгает. Без размеров остаётся усреднённая заглушка.
    const sized = !!att.width && !!att.height
    const frame = frameProps(att)
    return (
      <span
        // Рамка снимка в пузыре: из неё просмотрщик вырастает и в неё садится (MediaViewer).
        data-media-origin={att.id}
        className={cn(
          // w-fit обязателен: вложения лежат в колоночном флексе, и без него обёртка
          // растягивается на ширину пузыря — заглушка оказалась бы шире самого снимка.
          'relative inline-block w-fit overflow-hidden rounded-lg',
          // Есть размеры — коробка задана ими и держится всегда, а не только до загрузки.
          // Раньше после отрисовки её снимали, и форму снимка определял уже сам <img>
          // внутри флекс-колонки: широкое фото растягивалось на весь пузырь и обрезалось
          // по `max-h-64` в полосу. Коробка с `aspectRatio` не даёт этому случиться.
          sized ? frame.className : !painted && MEDIA_BOX,
        )}
        style={sized ? frame.style : undefined}
      >
        <img
          src={url}
          // Копия по ширине пузыря из медиа-системы; оригинал — только для просмотрщика и
          // скачивания. GIF — всегда оригинал: копия была бы первым кадром.
          srcSet={isGif ? undefined : srcSetOf(link?.sources, { url, width: att.width })}
          sizes={isGif || !link?.sources.length ? undefined : bubbleSizes(att)}
          alt={t('attachment')}
          loading="lazy"
          decoding="async"
          width={att.width ?? undefined}
          height={att.height ?? undefined}
          // Из кэша картинка бывает готова раньше, чем навесится onLoad, — проверяем complete.
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) setPainted(true)
          }}
          onLoad={() => setPainted(true)}
          onError={() => setBroken(true)}
          className={cn(
            'rounded-lg transition-[filter,opacity] duration-200',
            // В заданной коробке — по ней целиком (кроп исключён: коробка в пропорциях
            // снимка). Без размеров — по своим, с потолком высоты и ширины пузыря.
            sized ? 'size-full object-cover' : 'max-h-64 max-w-full object-contain',
            !painted && (sized ? 'opacity-0' : 'absolute inset-0 size-full opacity-0'),
            blurred && 'scale-105 blur-xl',
            uploading ? 'cursor-default' : 'cursor-pointer',
          )}
          onClick={uploading ? undefined : blurred ? () => setRevealed(true) : onOpen}
        />
        {!painted && <Lqip src={att.placeholder} className="rounded-lg" />}
        {blurred && painted && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-white"
          >
            {t('spoiler')}
          </button>
        )}
        {isGif && painted && !uploading && !blurred && <GifBadge />}
        {painted && !uploading && !blurred && !isGif && <ImagePrewarm url={url} link={link} />}
        {uploading && <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />}
      </span>
    )
  }
  if (isViewable(att) && att.mime.startsWith('video/')) {
    // Превью-кадр с кнопкой play; клик открывает полноэкранный просмотрщик (как в Telegram).
    // Контейнер, а не кнопка: поверх кадра лежат две кнопки — открыть ролик (весь кадр) и
    // скачать (плашка в углу: середину занимает воспроизведение), а кнопку в кнопку вложить
    // нельзя.
    //
    // Постер медиа-системы — картинка в десятки килобайт вместо `<video preload>`, который
    // ради первого кадра тянул начало самого ролика (а на iOS по сотовой не грузил вовсе).
    // Длительность тогда приходит с сервера. Постера нет (ролик ещё обрабатывается или
    // старше медиа-системы) — кадр, как раньше, берёт сам `<video>`.
    const poster = link?.poster ?? []
    const sized = !!att.width && !!att.height
    const frame = frameProps(att)
    const shownDuration = att.durationMs ? att.durationMs / 1000 : duration
    return (
      <div
        data-media-origin={att.id}
        className={cn(
          'relative block w-fit max-w-full overflow-hidden rounded-lg',
          // preload="metadata" на мобильной сети тянется долго (на iOS по сотовой может не
          // сработать вовсе) — подложку под кадр держим сами, без бесконечной пульсации.
          sized ? frame.className : !painted && MEDIA_BOX,
          // Пока кадра нет — светлая подложка с ▶, а не чёрный квадрат: ролик без постера
          // (.mov, кодек, который браузер не показывает) так и остаётся узнаваемым роликом.
          !painted && MEDIA_TINT,
        )}
        style={sized ? frame.style : undefined}
      >
        {poster.length > 0 ? (
          <img
            src={poster[poster.length - 1]?.url}
            srcSet={srcSetOf(poster)}
            sizes={bubbleSizes(att)}
            alt=""
            loading="lazy"
            decoding="async"
            width={att.width ?? undefined}
            height={att.height ?? undefined}
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0) setPainted(true)
            }}
            onLoad={() => setPainted(true)}
            onError={() => setBroken(true)}
            className={cn(
              'block transition-opacity duration-200',
              sized ? 'size-full object-cover' : 'max-h-64 max-w-full',
              !painted && 'opacity-0',
              blurred && 'scale-105 blur-xl',
            )}
          />
        ) : (
          <video
            src={url}
            preload="metadata"
            muted
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              if (Number.isFinite(d)) setDuration(d)
            }}
            // Кадр готов — только если браузер вообще умеет показать дорожку: у .mov с HEVC
            // метаданные есть, а картинки нет (videoWidth = 0), и на месте ролика был чёрный
            // квадрат. Не умеет — остаётся подложка с ▶: открыть и скачать ролик можно.
            onLoadedData={(e) => {
              if (e.currentTarget.videoWidth > 0) setPainted(true)
            }}
            // onError нет намеренно: не показался первый кадр — не повод рисовать вместо
            // ролика круг ошибки.
            className={cn(
              'max-h-64 max-w-full transition-opacity duration-200',
              sized && 'size-full object-cover',
              !painted && 'absolute inset-0 size-full object-cover opacity-0',
              blurred && 'scale-105 blur-xl',
            )}
          />
        )}
        {!painted && att.placeholder && <Lqip src={att.placeholder} />}
        {/* Длительность прячем под спойлером вместе с кадром: по ней узнаётся ролик. */}
        {!blurred && !uploading && <DurationBadge seconds={shownDuration} />}
        {uploading ? (
          <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />
        ) : blurred ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex cursor-pointer items-center justify-center text-xs font-semibold uppercase tracking-wide text-white"
          >
            {t('spoiler')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            aria-label={t('attachment')}
            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/20 transition-colors hover:bg-black/30"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white">
              <Play className="size-6 translate-x-0.5" aria-hidden />
            </span>
          </button>
        )}
        {painted && !uploading && !blurred && (
          <MediaDownloadPill att={att} url={url} corner auto={att.size <= AUTO_VIDEO_BYTES} />
        )}
      </div>
    )
  }
}

// Ширина альбома-мозаики в пузыре, px (уже — по ширине пузыря на узком экране).
const ALBUM_WIDTH = 320
// Ширина ячейки альбома для `sizes`: мозаика 320px, ячейка — обычно от трети до половины.
const TILE_SIZES = '150px'

// Ячейка альбома-сетки (Telegram-стиль): квадратный кроп через object-cover, поверх — play у видео
// и оверлей загрузки у оптимистичных. Размер задаёт родитель через className (aspect/row-span).
function GridTile({
  att,
  onOpen,
  onCancel,
  className,
  sendFailed,
  onRetry,
}: {
  att: MessageAttachment
  onOpen?: () => void
  onCancel?: () => void
  className?: string
  /** Сообщение не ушло — ячейка показывает повтор, а не вечный оверлей загрузки. */
  sendFailed?: boolean
  /** Повторить отправку всего сообщения. */
  onRetry?: () => void
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const { url, link, isLoading, isError, refetch } = useAttachmentUrl(att)
  // См. пояснение в Single: упавшая отправка не «грузится».
  const uploading = !!att.uploading && !sendFailed
  // Тип — по ссылке, если она его знает: GIF переводится в MP4 уже после отправки.
  const gif = isAnimatedNow(att, link)
  const isVid = gif || att.mime.startsWith('video/')
  const [painted, setPainted] = useState(false)
  const [broken, setBroken] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  // Спойлер (§34) — и в альбоме тоже. Он ставится на отдельное вложение (chats.service:
  // spoilerIndexes), поэтому в одном альбоме скрытые и открытые кадры соседствуют, а рисовала
  // спойлер когда-то только одиночная картинка: три снимка под спойлером уходили открытыми.
  const [revealed, setRevealed] = useState(false)
  const blurred = !!att.spoiler && !revealed
  const failed = isError || broken || (!!sendFailed && !!att.uploading)
  // Повтор у ячейки двух сортов: не ушло — отправляем сообщение заново, не скачалось —
  // перезапрашиваем ссылку. Нажатие одно и то же, а делать надо разное.
  const retry = (): void => {
    if (sendFailed && att.uploading) {
      onRetry?.()
      return
    }
    setBroken(false)
    setPainted(false)
    refetch()
  }
  // Контейнер, а не кнопка: нажатие по ячейке ловит слой-кнопка во весь кадр, а кнопка
  // скачивания — отдельная поверх него (вложить кнопку в кнопку нельзя).
  return (
    <div
      data-media-origin={att.id}
      className={cn('relative block overflow-hidden', MEDIA_TINT, className)}
    >
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center">
          {/* Не кнопка: нажатие ловит слой-кнопка во весь кадр (вложить кнопку в кнопку
              нельзя), она же при ошибке вызывает retry и носит подпись «Повторить». */}
          <span className={MEDIA_CIRCLE}>
            <RotateCw className="size-6" aria-hidden />
          </span>
        </span>
      ) : isLoading || !url ? (
        <Lqip src={att.placeholder} className={blurred ? 'blur-xl' : undefined} />
      ) : isVid ? (
        <>
          {link?.poster.length ? (
            // Постер вместо `<video preload>`: см. пояснение в Single.
            <img
              src={link.poster[0]?.url}
              srcSet={srcSetOf(link.poster)}
              sizes={TILE_SIZES}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setPainted(true)}
              onError={() => setBroken(true)}
              className={cn(
                'absolute inset-0 size-full object-cover transition-[filter] duration-200',
                blurred && 'scale-105 blur-xl',
              )}
            />
          ) : (
            <video
              src={url}
              preload="metadata"
              muted
              onLoadedMetadata={(e) => {
                setPainted(true)
                const d = e.currentTarget.duration
                if (Number.isFinite(d)) setDuration(d)
              }}
              onError={() => setBroken(true)}
              className={cn(
                'absolute inset-0 size-full object-cover transition-[filter] duration-200',
                blurred && 'scale-105 blur-xl',
              )}
            />
          )}
          {/* GIF в альбоме — постер с подписью, без ▶ и длительности: играет в просмотрщике. */}
          {!uploading && !blurred && gif && <GifBadge />}
          {!uploading && !blurred && !gif && (
            <DurationBadge seconds={att.durationMs ? att.durationMs / 1000 : duration} />
          )}
          {!uploading && !blurred && !gif && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/15">
              <span className="flex size-10 items-center justify-center rounded-full bg-black/50 text-white">
                <Play className="size-5 translate-x-0.5" aria-hidden />
              </span>
            </span>
          )}
        </>
      ) : (
        <>
          {!painted && <Lqip src={att.placeholder} />}
          <img
            src={url}
            // Ячейка ~150px: на ретине браузер возьмёт копию 320, а не многомегабайтный оригинал.
            srcSet={
              att.mime === 'image/gif'
                ? undefined
                : srcSetOf(link?.sources, { url, width: att.width })
            }
            sizes={link?.sources.length && att.mime !== 'image/gif' ? TILE_SIZES : undefined}
            alt=""
            loading="lazy"
            decoding="async"
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0) setPainted(true)
            }}
            onLoad={() => setPainted(true)}
            onError={() => setBroken(true)}
            className={cn(
              'absolute inset-0 size-full object-cover transition-[filter,opacity] duration-200',
              !painted && 'opacity-0',
              blurred && 'scale-105 blur-xl',
            )}
          />
        </>
      )}
      {blurred && painted && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.65rem] font-semibold uppercase tracking-wide text-white">
          {t('spoiler')}
        </span>
      )}
      {/* Битую ячейку клик перезагружает: открывать просмотрщик с той же ссылкой бессмысленно.
          Ячейка под спойлером первым кликом открывается, и только вторым — просмотрщик. */}
      {!uploading && (
        <button
          type="button"
          aria-label={failed ? tCommon('retry') : blurred ? t('spoiler') : t('attachment')}
          onClick={failed ? retry : blurred ? () => setRevealed(true) : onOpen}
          className="absolute inset-0 z-[1] cursor-pointer"
        />
      )}
      {url &&
        painted &&
        !uploading &&
        !blurred &&
        !failed &&
        !gif &&
        (isVid ? (
          <MediaDownloadPill
            att={att}
            url={url}
            compact
            corner
            auto={att.size <= AUTO_VIDEO_BYTES}
          />
        ) : (
          <ImagePrewarm url={url} link={link} />
        ))}
      {uploading && <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />}
    </div>
  )
}

// Альбом изображений/видео мозаикой, как в Telegram: раскладка — по пропорциям самих кадров
// (lib/album-layout): широкий первый снимок полосой сверху, узкий — колонкой слева, длинный
// альбом — рядами одной высоты. Пропорции известны заранее (сервер отдаёт width/height), поэтому
// место под альбом резервируется сразу и лента не прыгает, пока едут снимки. Кадр без размеров
// (видео, вложения старше полей) считается квадратом. Клик по ячейке — полноэкранный просмотр.
function MediaGrid({
  items,
  onOpen,
  onCancel,
  sendFailed,
  onRetry,
}: {
  items: MessageAttachment[]
  onOpen: (att: MessageAttachment) => void
  onCancel?: () => void
  sendFailed?: boolean
  onRetry?: () => void
}) {
  const layout = albumLayout(
    items.map((a) => (a.width && a.height ? a.width / a.height : 1)),
    ALBUM_WIDTH,
  )
  return (
    <div
      className="relative overflow-hidden rounded-lg"
      style={{ width: ALBUM_WIDTH, maxWidth: '100%', aspectRatio: layout.aspect }}
    >
      {items.map((att, i) => {
        const tile = layout.tiles[i]
        if (!tile) return null
        return (
          <div
            key={att.id}
            className="absolute"
            style={{
              left: `${tile.x * 100}%`,
              top: `${tile.y * 100}%`,
              width: `${tile.w * 100}%`,
              height: `${tile.h * 100}%`,
            }}
          >
            <GridTile
              att={att}
              onOpen={() => onOpen(att)}
              onCancel={onCancel}
              sendFailed={sendFailed}
              onRetry={onRetry}
              className="size-full"
            />
          </div>
        )
      })}
    </div>
  )
}

export function MessageAttachments({
  media,
  mine,
  onCancel,
  sendFailed,
  onRetry,
  viewerMeta,
  viewerActions,
  messageId,
  mediaRail,
}: {
  media: MessageAttachment[]
  mine: boolean
  /** Прервать загрузку сообщения целиком: вложения уходят одним запросом, отменяется он же. */
  onCancel?: () => void
  /** Отправка сообщения упала. Вложения обязаны это показать: сами они не доедут. */
  sendFailed?: boolean
  /** Повторить отправку всего сообщения — вложения уходят вместе с ним. */
  onRetry?: () => void
  viewerMeta?: MediaViewerMeta
  viewerActions?: MediaViewerActions
  /** id сообщения — нужен просмотрщику, листающему все медиа чата (`mediaRail`). */
  messageId?: string
  /**
   * Чат сообщения: просмотрщик листает все его фото и видео подряд, а не только вложения
   * этого сообщения. Нет (обсуждение события, поддержка) — только свои вложения.
   */
  mediaRail?: ChatMediaRailContext
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  if (media.length === 0) return null
  // Изображения/видео (viewable) — альбомом-сеткой; голосовые и файлы — отдельными строками.
  // Кружок — сам по себе: круг без пузыря, играет на месте, в просмотрщик не открывается.
  const rounds = media.filter(isVideoNote)
  const viewable = media.filter((a) => isViewable(a) && !isVideoNote(a))
  const others = media.filter((a) => !isViewable(a))
  const openViewer = (att: MessageAttachment): void =>
    setViewerIndex(viewable.findIndex((v) => v.id === att.id))
  // Голосовое — подписано автором, песня — своим названием, автор уходит во вторую строку
  // (как в панели плеера Telegram).
  const audioMetaOf = (att: MessageAttachment): VoiceTrackMeta | undefined => {
    if (!viewerMeta) return undefined
    const voice = isVoiceRecording(att)
    return {
      voice,
      title: voice ? viewerMeta.senderName : (att.name ?? viewerMeta.senderName),
      performer: voice ? null : viewerMeta.senderName,
      createdAt: viewerMeta.createdAt,
      onGoTo: viewerActions?.onGoTo,
    }
  }
  // Миниатюра кадра — в своём пузыре, а не первая попавшаяся на странице: тот же файл может
  // лежать и в соседнем пересланном сообщении, и в панели «Медиа».
  const originOf = (i: number): HTMLElement | null => {
    const id = viewable[i]?.id
    if (!id || !rootRef.current) return null
    return rootRef.current.querySelector<HTMLElement>(`[data-media-origin="${CSS.escape(id)}"]`)
  }
  // Лента всех медиа чата — только у доставленного сообщения: у ещё не отправленного файлов
  // на сервере нет, и номер кадра среди медиа чата спросить не о чем.
  const railOn =
    !!mediaRail &&
    !!messageId &&
    !messageId.startsWith('tmp:') &&
    !viewable.some((a) => a.uploading)
  const railStart = (index: number) => ({
    items: viewable.map((a): ChatMediaItem => ({
      id: a.id,
      messageId: messageId ?? '',
      name: a.name ?? null,
      mime: a.mime,
      size: a.size,
      hasPoster: false,
      width: a.width,
      height: a.height,
      placeholder: a.placeholder,
      durationMs: a.durationMs,
      createdAt: viewerMeta?.createdAt ?? '',
      sender: null,
    })),
    attachments: viewable,
    index,
    messageId,
    meta: viewerMeta,
    actions: viewerActions,
  })
  // Кадр своего сообщения — в своём пузыре; чужого — первый такой на экране (лента всех
  // медиа: кадр соседнего сообщения садится в свой пузырь, если тот виден).
  const originById = (id: string): HTMLElement | null => {
    const sel = `[data-media-origin="${CSS.escape(id)}"]`
    return rootRef.current?.querySelector<HTMLElement>(sel) ?? document.querySelector(sel)
  }
  return (
    <div ref={rootRef} className="mt-1 flex flex-col gap-1.5">
      {rounds.map((att) => (
        <RoundVideo
          key={att.id}
          att={att}
          onCancel={onCancel}
          sendFailed={sendFailed}
          onRetry={onRetry}
        />
      ))}
      {viewable.length >= 2 ? (
        <MediaGrid
          items={viewable}
          onOpen={openViewer}
          onCancel={onCancel}
          sendFailed={sendFailed}
          onRetry={onRetry}
        />
      ) : (
        viewable.map((att) => (
          <Single
            key={att.id}
            att={att}
            mine={mine}
            onOpen={() => openViewer(att)}
            onCancel={onCancel}
            sendFailed={sendFailed}
            onRetry={onRetry}
          />
        ))
      )}
      {others.map((att) => (
        <Single
          key={att.id}
          att={att}
          mine={mine}
          onCancel={onCancel}
          sendFailed={sendFailed}
          onRetry={onRetry}
          audioMeta={audioMetaOf(att)}
        />
      ))}
      {viewerIndex !== null && railOn && mediaRail && (
        <ChatMediaRailViewer
          rail={mediaRail}
          start={railStart(viewerIndex)}
          originOf={originById}
          onClose={() => setViewerIndex(null)}
        />
      )}
      {viewerIndex !== null && !railOn && (
        <MediaViewer
          items={viewable}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          meta={viewerMeta}
          actions={viewerActions}
          getOrigin={originOf}
        />
      )}
    </div>
  )
}
