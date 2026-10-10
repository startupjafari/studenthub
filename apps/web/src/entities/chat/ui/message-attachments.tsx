'use client'

import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowDown, Check, FileText, Loader2, Play, RotateCw, X } from 'lucide-react'
import {
  formatBytes,
  formatBytesProgress,
  useByteUnitLabel,
  useFileDownload,
} from '../../../shared/lib'
import { ProgressRing } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { fetchAttachmentUrl } from '../api/chat-api'
import { fileKind } from '../lib/file-kind'
// Те же признаки вида, что у превью в списке чатов, — один источник на оба места.
import { isViewable, isVoice } from '../lib/attachment-kind'
import type { MessageAttachment } from '../model/types'
import { VoiceMessage } from './voice-message'
import { MediaViewer, type MediaViewerActions, type MediaViewerMeta } from './media-viewer'

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
}: {
  att: MessageAttachment
  url: string
  compact?: boolean
  /** Середина кадра занята (ролик) — кнопка встаёт плашкой в правый верхний угол. */
  corner?: boolean
}) {
  const t = useTranslations('Chats')
  const unit = useByteUnitLabel()
  const download = useFileDownload(`file:${att.id ?? 'pending'}`, {
    url,
    name: att.name || t('attachment'),
    mime: att.mime,
  })
  const dl = download.state
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
  const q = useQuery({
    queryKey: ['chat-attachment', att.id],
    queryFn: () => fetchAttachmentUrl(att.id),
    enabled: !hasLocal,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  return {
    url: att.localUrl ?? q.data,
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

function Single({
  att,
  mine,
  onOpen,
  onCancel,
  sendFailed: messageFailed,
  onRetry,
}: {
  att: MessageAttachment
  mine: boolean
  onOpen?: () => void
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
  const { url, isLoading, isError, refetch } = useAttachmentUrl(att)
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

  if (isError || broken) {
    return (
      <MediaFailed
        className={framed ? MEDIA_BOX : 'w-56 max-w-full'}
        onRetry={() => {
          setBroken(false)
          setPainted(false)
          refetch()
        }}
      />
    )
  }

  if (isLoading || !url) {
    // Пока едет presigned-ссылка, место под снимок уже знает его форму (если размеры есть).
    // Заливка без пульсации: мигающий прямоугольник посреди переписки притягивал взгляд
    // сильнее самих сообщений, а держать место надо — иначе лента прыгает под руками.
    const frame = frameProps(att)
    return (
      <div
        className={cn('rounded-lg', MEDIA_TINT, framed ? frame.className : 'h-10 w-40')}
        style={framed ? frame.style : undefined}
        aria-hidden
      />
    )
  }

  if (isVoice(att)) {
    return (
      <span className={cn('relative inline-flex', uploading && 'opacity-60')}>
        <VoiceMessage url={url} seed={att.id} mine={mine} />
        {uploading && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">
            <Loader2 className="size-4 animate-spin opacity-70" aria-hidden />
          </span>
        )}
      </span>
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
        {!painted && <span className={cn('absolute inset-0 rounded-lg', MEDIA_TINT)} aria-hidden />}
        {blurred && painted && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-white"
          >
            {t('spoiler')}
          </button>
        )}
        {isGif && painted && !uploading && !blurred && (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[0.6rem] font-semibold uppercase text-white">
            GIF
          </span>
        )}
        {painted && !uploading && !blurred && <MediaDownloadPill att={att} url={url} />}
        {uploading && <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />}
      </span>
    )
  }
  if (isViewable(att) && att.mime.startsWith('video/')) {
    // Превью-кадр с кнопкой play; клик открывает полноэкранный просмотрщик (как в Telegram).
    // Контейнер, а не кнопка: поверх кадра лежат две кнопки — открыть ролик (весь кадр) и
    // скачать (плашка в углу: середину занимает воспроизведение), а кнопку в кнопку вложить
    // нельзя.
    return (
      <div
        className={cn(
          'relative block w-fit max-w-full overflow-hidden rounded-lg',
          // preload="metadata" на мобильной сети тянется долго (на iOS по сотовой может не
          // сработать вовсе) — подложку под кадр держим сами, без бесконечной пульсации.
          !painted && cn(MEDIA_BOX, MEDIA_TINT),
        )}
      >
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
            'max-h-64 max-w-full transition-opacity duration-200',
            !painted && 'absolute inset-0 size-full object-cover opacity-0',
            blurred && 'scale-105 blur-xl',
          )}
        />
        {/* Длительность прячем под спойлером вместе с кадром: по ней узнаётся ролик. */}
        {!blurred && !uploading && <DurationBadge seconds={duration} />}
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
        {painted && !uploading && !blurred && <MediaDownloadPill att={att} url={url} corner />}
      </div>
    )
  }
  // Карточка файла в стиле Telegram: круглая иконка + имя + размер. Нажатие скачивает файл
  // в приложение с прогрессом на значке (второе нажатие — отмена), готовый — сохраняет на
  // устройство. Раньше это была ссылка: браузер открывал PDF поверх приложения, а
  // прогресса и отмены не было вовсе.
  const dl = download.state
  const loading = dl.status === 'loading'
  return (
    <button
      type="button"
      // Упавшая отправка перехватывает нажатие: качать нечего — файл до сервера не доехал.
      onClick={sendFailed ? () => onRetry?.() : download.toggle}
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
      className="flex min-w-[220px] cursor-pointer items-center gap-2 py-0.5 text-left disabled:cursor-default"
    >
      {/* Значок расширения (§7 карты): цвет задаёт тип документа — в переписке с десятком
          вложений он различает архив, таблицу и картинку раньше, чем прочитано имя. */}
      <span
        className={cn(
          'relative flex size-10 shrink-0 items-center justify-center rounded-full text-white',
          uploading ? 'bg-muted-foreground' : kind.className,
        )}
      >
        {sendFailed ? (
          <RotateCw className="size-5" aria-hidden />
        ) : uploading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : loading ? (
          <X className="size-4" strokeWidth={2.5} aria-hidden />
        ) : kind.ext ? (
          <span className="text-[0.6rem] font-bold uppercase leading-none tracking-tight">
            {kind.ext}
          </span>
        ) : (
          <FileText className="size-5" aria-hidden />
        )}
        {loading && <ProgressRing progress={download.progress} />}
        {/* Угловой значок — что сделает нажатие: «↓» скачать, галочка — уже скачано.
            Обводка цветом пузыря отделяет его от значка расширения. */}
        {!uploading && !loading && !sendFailed && (
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border-2',
              mine
                ? 'border-primary bg-primary-foreground text-primary'
                : 'border-muted bg-background text-foreground',
            )}
          >
            {dl.status === 'ready' ? (
              <Check className="size-2.5" strokeWidth={3.5} />
            ) : dl.status === 'error' ? (
              // Не скачалось — в углу знак повтора, а не «вниз»: нажатие пробует ещё раз,
              // и значок обязан обещать то же, что обещает подпись.
              <RotateCw className="size-2.5" strokeWidth={3.5} />
            ) : (
              <ArrowDown className="size-2.5" strokeWidth={3.5} />
            )}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{att.name || t('attachment')}</span>
        <span className={cn('block text-xs', mine ? 'opacity-70' : 'text-muted-foreground')}>
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
  const { url, isLoading, isError, refetch } = useAttachmentUrl(att)
  // См. пояснение в Single: упавшая отправка не «грузится».
  const uploading = !!att.uploading && !sendFailed
  const isVid = att.mime.startsWith('video/')
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
    <div className={cn('relative block overflow-hidden', MEDIA_TINT, className)}>
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center">
          {/* Не кнопка: нажатие ловит слой-кнопка во весь кадр (вложить кнопку в кнопку
              нельзя), она же при ошибке вызывает retry и носит подпись «Повторить». */}
          <span className={MEDIA_CIRCLE}>
            <RotateCw className="size-6" aria-hidden />
          </span>
        </span>
      ) : isLoading || !url ? (
        <span className={cn('absolute inset-0', MEDIA_TINT)} aria-hidden />
      ) : isVid ? (
        <>
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
          {!uploading && !blurred && <DurationBadge seconds={duration} />}
          {!uploading && !blurred && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/15">
              <span className="flex size-10 items-center justify-center rounded-full bg-black/50 text-white">
                <Play className="size-5 translate-x-0.5" aria-hidden />
              </span>
            </span>
          )}
        </>
      ) : (
        <>
          <img
            src={url}
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
          {!painted && <span className={cn('absolute inset-0', MEDIA_TINT)} aria-hidden />}
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
      {url && painted && !uploading && !blurred && !failed && (
        <MediaDownloadPill att={att} url={url} compact corner={isVid} />
      )}
      {uploading && <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />}
    </div>
  )
}

// Альбом изображений/видео сеткой (Telegram-стиль): 2 и 4 — по два в ряд, 3 и 5+ — по три.
// Клик по ячейке открывает полноэкранный просмотрщик.
//
// Все ячейки квадратные. Прежняя мозаика делала первую из трёх высокой (`row-span-2`), и
// квадратный снимок в ней обрезался до вертикального прямоугольника — на превью от него
// оставалась полоса посередине. Настоящая мозаика Telegram подбирает раскладку по
// пропорциям самих снимков; выдавать за неё одну жёстко заданную форму — хуже, чем
// честная ровная сетка.
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
  const n = items.length
  const cols = n === 2 || n === 4 ? 'grid-cols-2' : 'grid-cols-3'
  const width = n === 2 || n === 4 ? 260 : 300
  return (
    <div
      className={cn('grid gap-0.5 overflow-hidden rounded-lg', cols)}
      style={{ width, maxWidth: '100%' }}
    >
      {items.map((att) => (
        <GridTile
          key={att.id}
          att={att}
          onOpen={() => onOpen(att)}
          onCancel={onCancel}
          sendFailed={sendFailed}
          onRetry={onRetry}
          className="aspect-square"
        />
      ))}
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
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  if (media.length === 0) return null
  // Изображения/видео (viewable) — альбомом-сеткой; голосовые и файлы — отдельными строками.
  const viewable = media.filter(isViewable)
  const others = media.filter((a) => !isViewable(a))
  const openViewer = (att: MessageAttachment): void =>
    setViewerIndex(viewable.findIndex((v) => v.id === att.id))
  return (
    <div className="mt-1 flex flex-col gap-1.5">
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
        />
      ))}
      {viewerIndex !== null && (
        <MediaViewer
          items={viewable}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          meta={viewerMeta}
          actions={viewerActions}
        />
      )}
    </div>
  )
}
