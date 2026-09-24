'use client'

import { useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { FileText, ImageOff, Loader2, Play, X } from 'lucide-react'
import { formatBytes, formatBytesProgress, useByteUnitLabel } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { fetchAttachmentUrl } from '../api/chat-api'
import { fileKind } from '../lib/file-kind'
import type { MessageAttachment } from '../model/types'
import { VoiceMessage } from './voice-message'
import { MediaViewer, type MediaViewerActions, type MediaViewerMeta } from './media-viewer'

// Голосовое сообщение (плеер-волна), а не обычное аудио/видео вложение.
// Основной признак — имя из встроенного рекордера (`voice-…`), т.к. mime по содержимому непредсказуем:
// webm → video/webm, iOS-запись → video/mp4. Для старых сообщений — запасная эвристика по mime.
function isVoice(att: MessageAttachment): boolean {
  if (att.name && /^voice-/i.test(att.name)) return true
  return att.mime.startsWith('audio/') || att.mime === 'video/webm'
}

// Открывается ли вложение в полноэкранном просмотрщике (картинка или реальное видео, не голосовое).
//
// `asDocument` перевешивает mime: снимок, отправленный «без сжатия», получатель видит строкой
// файла — ровно так, как выбрал отправитель. Иначе выбор способа отправки не доезжал бы дальше
// окна отправки, а картинка всё равно приходила бы превью.
function isViewable(att: MessageAttachment): boolean {
  if (isVoice(att) || att.asDocument) return false
  return att.mime.startsWith('image/') || att.mime.startsWith('video/')
}

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

// Запасное место под снимок, когда размеров нет (видео, вложения старше полей width/height):
// усреднённый прямоугольник. Без него пузырь схлопывается в ноль, а потом прыгает на всю
// высоту картинки, и на медленной сети в нём зияет пустой цветной прямоугольник.
const MEDIA_BOX = 'h-40 w-56 max-w-full'
// Потолок высоты медиа в пузыре — тот же max-h-64, что и у самой картинки.
const MEDIA_MAX_H = 256
// Заглушка/подложка читается и на синем «своём» пузыре, и на сером чужом.
const MEDIA_TINT = 'bg-foreground/10'

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
function MediaFailed({ className, onRetry }: { className?: string; onRetry: () => void }) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  return (
    <span
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg p-3 text-center',
        MEDIA_TINT,
        className,
      )}
    >
      <ImageOff className="size-5 opacity-60" aria-hidden />
      <span className="text-xs opacity-70">{t('mediaFailed')}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRetry()
        }}
        className="text-xs font-medium underline underline-offset-2"
      >
        {tCommon('retry')}
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
          className="relative flex size-12 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
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
        <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white">
          {content}
        </span>
      )}
    </span>
  )
}

function Single({
  att,
  mine,
  onOpen,
  onCancel,
}: {
  att: MessageAttachment
  mine: boolean
  onOpen?: () => void
  /** Прервать загрузку этого сообщения (крестик в оверлее). Нет — отменять нечего. */
  onCancel?: () => void
}) {
  const t = useTranslations('Chats')
  const unit = useByteUnitLabel()
  // Длительность ролика: читаем у того же элемента, что уже тянет первый кадр.
  const [duration, setDuration] = useState<number | null>(null)
  const { url, isLoading, isError, refetch } = useAttachmentUrl(att)
  const uploading = !!att.uploading
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
        {uploading && <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />}
      </span>
    )
  }
  if (isViewable(att) && att.mime.startsWith('video/')) {
    // Превью-кадр с кнопкой play; клик открывает полноэкранный просмотрщик (как в Telegram).
    return (
      <button
        type="button"
        onClick={uploading ? undefined : blurred ? () => setRevealed(true) : onOpen}
        disabled={uploading}
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
          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-white">
            {t('spoiler')}
          </span>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30">
            <span className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white">
              <Play className="size-6 translate-x-0.5" aria-hidden />
            </span>
          </span>
        )}
      </button>
    )
  }
  // Карточка файла в стиле Telegram: круглая иконка + имя + размер, клик — скачать.
  return (
    <a
      href={uploading ? undefined : url}
      target="_blank"
      rel="noopener noreferrer"
      download
      className={cn(
        'flex min-w-[220px] items-center gap-2 py-0.5',
        uploading && 'pointer-events-none',
      )}
    >
      {/* Значок расширения (§7 карты): цвет задаёт тип документа — в переписке с десятком
          вложений он различает архив, таблицу и картинку раньше, чем прочитано имя. */}
      <span
        className={cn(
          'relative flex size-10 shrink-0 items-center justify-center rounded-full text-white',
          uploading ? 'bg-muted-foreground' : kind.className,
        )}
      >
        {uploading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : kind.ext ? (
          <span className="text-[0.6rem] font-bold uppercase leading-none tracking-tight">
            {kind.ext}
          </span>
        ) : (
          <FileText className="size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{att.name || t('attachment')}</span>
        <span className={cn('block text-xs', mine ? 'opacity-70' : 'text-muted-foreground')}>
          {/* Прогресс мегабайтами, а не процентами: «11.5 / 40.1 МБ» сразу говорит и сколько
              осталось, и сколько весит файл, — процент отвечает только на первое. */}
          {uploading && att.progress != null
            ? formatBytesProgress(att.progress * att.size, att.size, unit)
            : formatBytes(att.size, unit)}
        </span>
      </span>
    </a>
  )
}

// Ячейка альбома-сетки (Telegram-стиль): квадратный кроп через object-cover, поверх — play у видео
// и оверлей загрузки у оптимистичных. Размер задаёт родитель через className (aspect/row-span).
function GridTile({
  att,
  onOpen,
  onCancel,
  className,
}: {
  att: MessageAttachment
  onOpen?: () => void
  onCancel?: () => void
  className?: string
}) {
  const t = useTranslations('Chats')
  const { url, isLoading, isError, refetch } = useAttachmentUrl(att)
  const uploading = !!att.uploading
  const isVid = att.mime.startsWith('video/')
  const [painted, setPainted] = useState(false)
  const [broken, setBroken] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  // Спойлер (§34) — и в альбоме тоже. Он ставится на отдельное вложение (chats.service:
  // spoilerIndexes), поэтому в одном альбоме скрытые и открытые кадры соседствуют, а рисовала
  // спойлер когда-то только одиночная картинка: три снимка под спойлером уходили открытыми.
  const [revealed, setRevealed] = useState(false)
  const blurred = !!att.spoiler && !revealed
  const failed = isError || broken
  const retry = (): void => {
    setBroken(false)
    setPainted(false)
    refetch()
  }
  return (
    <button
      type="button"
      // Битую ячейку клик перезагружает: открывать просмотрщик с той же ссылкой бессмысленно.
      // Ячейка под спойлером первым кликом открывается, и только вторым — просмотрщик.
      onClick={uploading ? undefined : failed ? retry : blurred ? () => setRevealed(true) : onOpen}
      disabled={uploading}
      className={cn('relative block overflow-hidden', MEDIA_TINT, className)}
    >
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <ImageOff className="size-5 opacity-60" aria-hidden />
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
        <span className="absolute inset-0 flex items-center justify-center text-[0.65rem] font-semibold uppercase tracking-wide text-white">
          {t('spoiler')}
        </span>
      )}
      {uploading && <MediaUploadOverlay progress={att.progress} onCancel={onCancel} />}
    </button>
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
}: {
  items: MessageAttachment[]
  onOpen: (att: MessageAttachment) => void
  onCancel?: () => void
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
  viewerMeta,
  viewerActions,
}: {
  media: MessageAttachment[]
  mine: boolean
  /** Прервать загрузку сообщения целиком: вложения уходят одним запросом, отменяется он же. */
  onCancel?: () => void
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
        <MediaGrid items={viewable} onOpen={openViewer} onCancel={onCancel} />
      ) : (
        viewable.map((att) => (
          <Single
            key={att.id}
            att={att}
            mine={mine}
            onOpen={() => openViewer(att)}
            onCancel={onCancel}
          />
        ))
      )}
      {others.map((att) => (
        <Single key={att.id} att={att} mine={mine} onCancel={onCancel} />
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
