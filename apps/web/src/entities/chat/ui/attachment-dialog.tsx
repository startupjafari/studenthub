'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Eye,
  EyeOff,
  FileText,
  FileUp,
  Images,
  ImagePlus,
  MoreVertical,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Modal,
} from '../../../shared/ui'
import { formatBytes, useByteUnitLabel } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { fileKind } from '../lib/file-kind'

/**
 * Потолок вложений в одном альбоме. Столько же держит Telegram, и причина та же: мозаика из
 * большего числа плиток перестаёт читаться, а пузырь занимает весь экран. Всё сверх — следующий
 * альбом, то есть следующее сообщение.
 */
export const ALBUM_MAX_ITEMS = 10

/** Как уходят выбранные файлы. Выбор живёт в диалоге и передаётся наружу вместе с подписью. */
export interface AttachmentSendOptions {
  /**
   * Снимки под спойлером (§34) — ссылками на файлы, а не номерами: отправляются они пачками
   * по альбомам, и номер внутри пачки считает уже отправитель.
   */
  spoilered: File[]
  /** Собрать медиа в альбомы по {@link ALBUM_MAX_ITEMS}. Выключено — каждый снимок отдельным сообщением. */
  grouped: boolean
  /** Отправить как файлы: без превью-плиток, строками файлового менеджера. */
  asFiles: boolean
}

function isMedia(f: File): boolean {
  return f.type.startsWith('image/') || f.type.startsWith('video/')
}

/** `0:55`, `1:02:30` — как на плитке видео в Telegram. */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** Локальное превью выбранного файла: object-URL создаём и освобождаем на месте. */
function useObjectUrl(file: File, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, enabled])
  return url
}

/** Квадратная иконка с расширением — та же палитра, что у вложения в пузыре сообщения. */
function ExtensionIcon({ name, mime }: { name: string; mime: string }) {
  const kind = fileKind(name, mime)
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg text-white',
        kind.className,
      )}
    >
      {kind.ext ? (
        <span className="text-[0.6rem] font-bold uppercase leading-none tracking-tight">
          {kind.ext}
        </span>
      ) : (
        <FileText className="size-5" aria-hidden />
      )}
    </span>
  )
}

/** Крестик на самой плитке: снимок узнают в лицо, и убирать его логично оттуда же, куда смотрят. */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute right-1 top-1 z-10 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  )
}

/** Плитка фото или видео: превью, длительность ролика, размер, спойлер, крестик. */
function MediaTile({
  file,
  onRemove,
  removeLabel,
  spoiler,
  onToggleSpoiler,
  spoilerOnLabel,
  spoilerOffLabel,
  className,
  fit = 'cover',
}: {
  file: File
  onRemove: () => void
  removeLabel: string
  /** Снимок уйдёт скрытым: в диалоге он тоже размыт — видно, что получит собеседник. */
  spoiler: boolean
  onToggleSpoiler: () => void
  spoilerOnLabel: string
  spoilerOffLabel: string
  className?: string
  /** `contain` — одиночный снимок показывается целиком; в мозаике плитки кадрируются. */
  fit?: 'cover' | 'contain'
}) {
  const url = useObjectUrl(file, true)
  const unit = useByteUnitLabel()
  const isVideo = file.type.startsWith('video/')
  // Длительность читаем из самого элемента: метаданные уже грузятся ради первого кадра,
  // второй скрытый <video> ради одной цифры был бы лишней загрузкой тех же байтов.
  const [duration, setDuration] = useState<number | null>(null)

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg bg-muted',
        // Размытие на самой плитке, а не только пометка уголком: спойлер выбирают, чтобы
        // снимок не было видно, и проверить это надо здесь, до отправки.
        spoiler && '[&>img]:blur-md [&>video]:blur-md',
        className,
      )}
    >
      {url &&
        (isVideo ? (
          <video
            src={url}
            muted
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              if (Number.isFinite(d)) setDuration(d)
            }}
            className={cn('size-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
          />
        ) : (
          <img
            src={url}
            alt=""
            className={cn('size-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
          />
        ))}
      {isVideo && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white">
            <Play className="size-4 translate-x-px" aria-hidden />
          </span>
        </span>
      )}
      {isVideo && duration != null && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
          {formatDuration(duration)}
        </span>
      )}
      <RemoveButton label={removeLabel} onClick={onRemove} />
      {/* Спойлер ставится на снимок, а не на отправку целиком: скрыть могут один кадр из
          десяти. Кнопка живёт на плитке — там же, где решают, что именно прятать. */}
      <button
        type="button"
        aria-label={spoiler ? spoilerOffLabel : spoilerOnLabel}
        title={spoiler ? spoilerOffLabel : spoilerOnLabel}
        aria-pressed={spoiler}
        onClick={onToggleSpoiler}
        className={cn(
          'absolute bottom-1 right-1 z-10 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75',
          // Скрытая плитка держит кнопку на виду и на ПК: иначе размытие выглядит сбоем
          // загрузки, и непонятно, чем его снять.
          !spoiler && 'lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100',
        )}
      >
        {spoiler ? (
          <Eye className="size-3.5" aria-hidden />
        ) : (
          <EyeOff className="size-3.5" aria-hidden />
        )}
      </button>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[0.65rem] text-white/90">
        {formatBytes(file.size, unit)}
      </span>
    </div>
  )
}

/** Строка файла: иконка с расширением, имя, размер, корзина. */
function FileRow({
  file,
  onRemove,
  removeLabel,
}: {
  file: File
  onRemove: () => void
  removeLabel: string
}) {
  const unit = useByteUnitLabel()
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-2">
      <ExtensionIcon name={file.name} mime={file.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span className="block text-xs text-muted-foreground">{formatBytes(file.size, unit)}</span>
      </span>
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  )
}

type Indexed = { file: File; index: number }

/** Разрезать список на альбомы по {@link ALBUM_MAX_ITEMS}. */
function toStacks<T>(items: T[]): T[][] {
  const stacks: T[][] = []
  for (let i = 0; i < items.length; i += ALBUM_MAX_ITEMS) {
    stacks.push(items.slice(i, i + ALBUM_MAX_ITEMS))
  }
  return stacks
}

/**
 * Общее для всех плиток окна: подписи и обработчики по номеру вложения. Собрано в один объект,
 * потому что плитка рисуется из четырёх мест раскладки, и протаскивать шесть одинаковых пропсов
 * через каждое — верный способ рано или поздно забыть один.
 */
interface TileCommon {
  removeLabel: string
  spoilerOnLabel: string
  spoilerOffLabel: string
  /** Скрытые снимки — по ссылке на файл: удаление соседа сдвигает номера, а ссылка живёт. */
  spoilered: Set<File>
  onRemove: (index: number) => void
  onToggleSpoiler: (file: File) => void
}

function Tile({
  item,
  common,
  className,
  fit,
}: {
  item: Indexed
  common: TileCommon
  className?: string
  fit?: 'cover' | 'contain'
}) {
  return (
    <MediaTile
      file={item.file}
      removeLabel={common.removeLabel}
      onRemove={() => common.onRemove(item.index)}
      spoiler={common.spoilered.has(item.file)}
      onToggleSpoiler={() => common.onToggleSpoiler(item.file)}
      spoilerOnLabel={common.spoilerOnLabel}
      spoilerOffLabel={common.spoilerOffLabel}
      className={className}
      fit={fit}
    />
  )
}

/**
 * Мозаика одного альбома — тем же принципом, что и пузырь с медиа в ленте: одиночный снимок
 * показывается целиком, дальше плитки кадрируются в сетку. Раскладка зависит от числа снимков,
 * потому что три квадрата в ряд и три разного размера читаются по-разному: у альбома должен
 * быть главный кадр.
 */
function AlbumMosaic({ items, common }: { items: Indexed[]; common: TileCommon }) {
  const n = items.length

  if (n === 1) {
    return <Tile item={items[0]} common={common} className="max-h-72 w-full" fit="contain" />
  }

  // Три снимка: крупный слева на всю высоту, два малых столбиком справа.
  if (n === 3) {
    return (
      <div className="grid h-56 grid-cols-2 grid-rows-2 gap-1">
        <Tile item={items[0]} common={common} className="row-span-2 size-full" />
        {items.slice(1).map((item) => (
          <Tile
            key={`${item.file.name}-${item.index}`}
            item={item}
            common={common}
            className="size-full"
          />
        ))}
      </div>
    )
  }

  return (
    <div className={cn('grid gap-1', n === 2 || n === 4 ? 'grid-cols-2' : 'grid-cols-3')}>
      {items.map((item) => (
        <Tile
          key={`${item.file.name}-${item.index}`}
          item={item}
          common={common}
          className="aspect-square w-full"
        />
      ))}
    </div>
  )
}

/**
 * Диалог отправки файлов (Telegram-стиль §9): что именно уходит, подпись и способ отправки.
 *
 * Три вида превью, и переключает их меню «…» в шапке — ровно как в Telegram, потому что
 * выбранный способ отправки должен быть виден до нажатия «Отправить», а не выясняться по
 * тому, что пришло собеседнику:
 *
 * - альбом — мозаика стопками по {@link ALBUM_MAX_ITEMS}, каждая стопка уйдёт одним сообщением;
 * - без группировки — колонка снимков, каждый уйдёт отдельным сообщением;
 * - без сжатия — строки файлового менеджера с расширением и размером.
 */
export function AttachmentDialog({
  files,
  sending,
  onSend,
  onAddMore,
  onRemove,
  onClose,
}: {
  files: File[]
  sending: boolean
  onSend: (caption: string, options: AttachmentSendOptions) => void
  onAddMore: () => void
  onRemove: (index: number) => void
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const [caption, setCaption] = useState('')
  const [spoilered, setSpoilered] = useState<Set<File>>(() => new Set())
  const [grouped, setGrouped] = useState(true)
  const [asFiles, setAsFiles] = useState(false)

  // Индексы сохраняем: onRemove работает по позиции в исходном списке, а мы его делим надвое.
  const indexed: Indexed[] = files.map((file, index) => ({ file, index }))
  const media = indexed.filter((f) => isMedia(f.file))
  const docs = indexed.filter((f) => !isMedia(f.file))
  const removeLabel = t('removeAttachment')
  // Документы и так уходят файлами: для них переключатели способа отправки не значат ничего,
  // и показывать заведомо неработающие пункты меню нечестно.
  const hasMedia = media.length > 0
  const showAsFiles = asFiles || !hasMedia
  const allVideo = hasMedia && media.every((f) => f.file.type.startsWith('video/'))

  // «Скрыть всё» / «Отменить скрытие» — одно и то же действие в двух положениях: пока скрыто
  // не всё, пункт предлагает скрыть; когда скрыто всё — снять.
  const allSpoilered = hasMedia && media.every((m) => spoilered.has(m.file))

  function toggleSpoiler(file: File): void {
    setSpoilered((prev) => {
      const next = new Set(prev)
      if (!next.delete(file)) next.add(file)
      return next
    })
  }

  function toggleSpoilerAll(): void {
    setSpoilered(allSpoilered ? new Set() : new Set(media.map((m) => m.file)))
  }

  const tileCommon: TileCommon = {
    removeLabel,
    spoilerOnLabel: t('spoilerToggle'),
    spoilerOffLabel: t('spoilerOff'),
    spoilered,
    onRemove,
    onToggleSpoiler: toggleSpoiler,
  }

  const title = showAsFiles
    ? t('sendFilesTitle', { count: files.length })
    : allVideo
      ? t('sendVideosTitle', { count: media.length })
      : t('sendPhotosTitle', { count: media.length })

  function send(): void {
    if (files.length === 0 || sending) return
    // Файлами уходит всё скопом и без спойлеров: размывать строку файлового менеджера нечего.
    onSend(caption, {
      spoilered: showAsFiles ? [] : media.filter((m) => spoilered.has(m.file)).map((m) => m.file),
      grouped,
      asFiles: showAsFiles,
    })
  }

  return (
    <Modal
      onClose={onClose}
      // Заголовок называет, что именно уходит: «Отправить как файл» над тремя снимками
      // обещало не то, что произойдёт.
      title={title}
      size="lg"
      headerAction={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" icon aria-label={t('sendOptions')}>
              <MoreVertical className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onAddMore}>
              <ImagePlus aria-hidden />
              {t('addMore')}
            </DropdownMenuItem>
            {hasMedia && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setAsFiles((v) => !v)}>
                  <FileUp aria-hidden />
                  {asFiles ? t('sendCompressed') : t('sendUncompressed')}
                </DropdownMenuItem>
                {/* Группировка имеет смысл, только пока снимков больше одного и они идут
                    превью: у файлов альбомов не бывает. */}
                {!showAsFiles && media.length > 1 && (
                  <DropdownMenuItem onClick={() => setGrouped((v) => !v)}>
                    <Images aria-hidden />
                    {grouped ? t('ungroupAlbum') : t('groupAsAlbum')}
                  </DropdownMenuItem>
                )}
                {!showAsFiles && (
                  <DropdownMenuItem onClick={toggleSpoilerAll}>
                    {allSpoilered ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                    {allSpoilered ? t('spoilerOff') : t('spoilerAll')}
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
          {showAsFiles ? (
            indexed.map(({ file, index }) => (
              <FileRow
                key={`${file.name}-${index}`}
                file={file}
                removeLabel={removeLabel}
                onRemove={() => onRemove(index)}
              />
            ))
          ) : (
            <>
              {/* Альбом — мозаикой стопками; без группировки — колонкой, где каждый снимок
                  сам по себе, потому что каждый и уйдёт сам по себе. */}
              {grouped
                ? toStacks(media).map((stack) => (
                    <AlbumMosaic
                      key={`stack-${stack[0].index}`}
                      items={stack}
                      common={tileCommon}
                    />
                  ))
                : media.map((item) => (
                    <Tile
                      key={`${item.file.name}-${item.index}`}
                      item={item}
                      common={tileCommon}
                      className="max-h-56 w-full"
                      fit="contain"
                    />
                  ))}
              {/* Документы, выбранные вместе со снимками, остаются строками: у них
                  узнаваемо как раз имя, а не превью. */}
              {docs.map(({ file, index }) => (
                <FileRow
                  key={`doc-${file.name}-${index}`}
                  file={file}
                  removeLabel={removeLabel}
                  onRemove={() => onRemove(index)}
                />
              ))}
            </>
          )}
        </div>

        {/* Сколько сообщений уйдёт — видно до отправки: одиннадцать снимков альбомом это
            два пузыря, а без группировки одиннадцать, и узнавать об этом постфактум поздно. */}
        {!showAsFiles && media.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {grouped
              ? t('albumStacks', { count: toStacks(media).length })
              : t('separateMessages', { count: media.length })}
          </p>
        )}

        <input
          autoFocus
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={t('captionPlaceholder')}
          className="h-10 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
        />

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" loading={sending} disabled={files.length === 0} onClick={send}>
            {t('send')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
