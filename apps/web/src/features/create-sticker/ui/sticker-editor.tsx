'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, Check, Loader2, Smile, Sparkles, Square, Scan } from 'lucide-react'
import { USER_STICKER_LIMITS } from '@studenthub/shared-schemas'
import { fetchAttachmentLink } from '../../../entities/chat'
import {
  addStickerRequest,
  createMyStickerSetRequest,
  fetchMyStickerSet,
  fetchMyStickerSets,
  userStickerKeys,
  type MyStickerSet,
  type StickerSource,
  type StickerUploadInput,
} from '../../../entities/sticker-set'
import { Button, EmojiPicker, Input, MediaEditorShell } from '../../../shared/ui'
import { prefersReducedMotion } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  composeStaticSticker,
  cropFraction,
  fitSide,
  fullCrop,
  moveCrop,
  OUTLINE_PX,
  fontPxFor,
  renderTextOverlay,
  resizeCrop,
  squareCrop,
  textFont,
  type Corner,
  type CropRect,
  type Size,
  type StickerText,
} from '../model/sticker-canvas'

type MediaKind = 'image' | 'gif' | 'video'

/** Эмодзи-метки под рукой; остальные — из полного списка. */
const QUICK_EMOJI = ['😀', '😂', '😍', '😎', '😭', '😡', '👍', '🙏', '🔥', '❤️', '🎉', '🤔']
/** Цвета надписи: подпись для читалки — ключом перевода. */
const TEXT_COLORS = [
  { hex: '#ffffff', key: 'tgStickers.colorWhite' },
  { hex: '#111111', key: 'tgStickers.colorBlack' },
  { hex: '#ffd60a', key: 'tgStickers.colorYellow' },
  { hex: '#ff3b30', key: 'tgStickers.colorRed' },
  { hex: '#0a84ff', key: 'tgStickers.colorBlue' },
  { hex: '#34c759', key: 'tgStickers.colorGreen' },
] as const
/** Отступ сцены вокруг снимка, px. */
const STAGE_PAD = 24
/** Сторона стикера в превью «как в чате» — как в пузыре переписки. */
const CHAT_PREVIEW = 160
/** Как часто спрашивать, собрана ли анимация, и сколько ждать. */
const POLL_MS = 1500
const POLL_LIMIT_MS = 2 * 60 * 1000

function kindOf(mime: string): MediaKind | null {
  if (mime === 'image/gif') return 'gif'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  return null
}

interface LoadedMedia {
  kind: MediaKind
  url: string
  /** Картинку можно нарисовать в canvas и прочитать (свой файл или ссылка с CORS). */
  drawable: boolean
  /** Отозвать object URL при закрытии. */
  revoke?: () => void
}

type MediaState =
  | { status: 'loading' }
  | { status: 'error'; reason: 'load' | 'type' | 'size' }
  | ({ status: 'ready' } & LoadedMedia)

/**
 * Открыть исходник: свой файл — object URL; вложение переписки — по подписанной ссылке.
 * Снимок из переписки пробуем скачать (тогда обрезка, обводка и надпись — на устройстве);
 * не вышло — показываем по ссылке, а кадрирует и кладёт надпись сервер.
 */
function useSourceMedia(source: StickerSource): MediaState {
  const [state, setState] = useState<MediaState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    let revoke: (() => void) | undefined
    const done = (next: MediaState): void => {
      if (cancelled) {
        if (next.status === 'ready') next.revoke?.()
        return
      }
      setState(next)
    }
    if (source.kind === 'file') {
      const kind = kindOf(source.file.type)
      if (!kind) {
        done({ status: 'error', reason: 'type' })
      } else if (kind !== 'image' && source.file.size > USER_STICKER_LIMITS.SOURCE_MAX_BYTES) {
        done({ status: 'error', reason: 'size' })
      } else {
        const url = URL.createObjectURL(source.file)
        revoke = () => URL.revokeObjectURL(url)
        done({ status: 'ready', kind, url, drawable: true, revoke })
      }
    } else {
      const kind = kindOf(source.mime)
      if (!kind) {
        done({ status: 'error', reason: 'type' })
      } else {
        void fetchAttachmentLink(source.fileId)
          .then(async (link) => {
            if (kind !== 'image')
              return done({ status: 'ready', kind, url: link.url, drawable: false })
            try {
              const res = await fetch(link.url)
              if (!res.ok) throw new Error(String(res.status))
              const url = URL.createObjectURL(await res.blob())
              revoke = () => URL.revokeObjectURL(url)
              done({ status: 'ready', kind, url, drawable: true, revoke })
            } catch {
              done({ status: 'ready', kind, url: link.url, drawable: false })
            }
          })
          .catch(() => done({ status: 'error', reason: 'load' }))
      }
    }
    return () => {
      cancelled = true
      revoke?.()
    }
  }, [source])
  return state
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = url
  })
}

/** «1,5 с» — секунды с одной цифрой после запятой в языке интерфейса. */
function useSeconds(): (ms: number) => string {
  const t = useTranslations('Chats')
  return (ms) =>
    t('tgStickers.seconds', {
      value: (Math.round(ms / 100) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }),
    })
}

/** Белая «обводка» на превью: настоящую рисует canvas при сохранении. */
const OUTLINE_FILTER =
  'drop-shadow(2px 0 0 #fff) drop-shadow(-2px 0 0 #fff) drop-shadow(0 2px 0 #fff) drop-shadow(0 -2px 0 #fff)'

/**
 * Стикер «как в чате»: кадр снимка или видео в рамке итогового размера, обводка и надпись —
 * тем же расчётом, что при сохранении. Видео играет выбранный отрезок по кругу.
 */
function CroppedPreview({
  media,
  nat,
  crop,
  outline,
  text,
  segment,
  side,
}: {
  media: LoadedMedia
  nat: Size
  crop: CropRect
  outline: boolean
  text: StickerText
  segment: { start: number; len: number }
  side: number
}) {
  const out = fitSide(crop.w, crop.h)
  const k = side / Math.max(out.w, out.h)
  const box = { w: out.w * k, h: out.h * k }
  const pad = outline ? OUTLINE_PX * k : 0
  const inner = { w: box.w - pad * 2, h: box.h - pad * 2 }
  const s = inner.w / crop.w
  const style = {
    position: 'absolute' as const,
    left: pad - crop.x * s,
    top: pad - crop.y * s,
    width: nat.w * s,
    height: nat.h * (inner.h / crop.h),
    maxWidth: 'none',
  }
  const fontPx = fontPxFor(out, text.value) * k
  return (
    <div className="relative overflow-hidden" style={{ width: box.w, height: box.h }}>
      {/* Обводка — фильтром снаружи, обрезка — внутри: иначе clip-path срезал бы обводку. */}
      <div className="absolute inset-0" style={{ filter: outline ? OUTLINE_FILTER : undefined }}>
        <div className="absolute inset-0" style={{ clipPath: `inset(${pad}px)` }}>
          {media.kind === 'video' ? (
            <SegmentVideo url={media.url} segment={segment} style={style} />
          ) : (
            <img src={media.url} alt="" draggable={false} style={style} />
          )}
        </div>
      </div>
      {text.value.trim() && (
        <span
          aria-hidden
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
          style={{
            left: text.x * box.w,
            top: text.y * box.h,
            font: textFont(Math.max(6, fontPx)),
            color: text.color,
            WebkitTextStroke: `${Math.max(1, fontPx * 0.08)}px rgba(0,0,0,0.6)`,
            paintOrder: 'stroke fill',
          }}
        >
          {text.value}
        </span>
      )}
    </div>
  )
}

/** Видео, которое играет без звука отрезок [start, start + len] по кругу. */
function SegmentVideo({
  url,
  segment,
  style,
  videoRef,
  onMeta,
}: {
  url: string
  segment: { start: number; len: number }
  style?: React.CSSProperties
  videoRef?: React.Ref<HTMLVideoElement>
  onMeta?: (v: HTMLVideoElement) => void
}) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.currentTime = segment.start / 1000
    if (!prefersReducedMotion()) void v.play().catch(() => undefined)
  }, [segment.start])
  return (
    <video
      ref={(el) => {
        ref.current = el
        if (typeof videoRef === 'function') videoRef(el)
        else if (videoRef && 'current' in videoRef) {
          ;(videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el
        }
      }}
      src={url}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(e) => onMeta?.(e.currentTarget)}
      onTimeUpdate={(e) => {
        const v = e.currentTarget
        if (
          v.currentTime * 1000 >= segment.start + segment.len ||
          v.currentTime * 1000 < segment.start - 50
        ) {
          v.currentTime = segment.start / 1000
        }
      }}
      style={style}
      className="pointer-events-none"
    />
  )
}

/**
 * Редактор своего стикера в духе Telegram: исходник во всю сцену, рамка кадрирования
 * (квадрат или свободная), белая обводка по контуру прозрачности, надпись поверх, эмодзи-метка
 * и превью «как в чате». У видео — выбор отрезка до 3 секунд. Второй шаг — «В набор…»:
 * свой набор или новый, названием в одно поле.
 *
 * Статичный стикер собирается здесь же в canvas (PNG 512) и сервер лишь переводит его в WebP.
 * GIF и видео уходят исходником с параметрами: анимированный WebP собирает медиа-воркер,
 * а редактор ждёт его, перечитывая набор.
 */
export function StickerEditor({
  source,
  initialSetId,
  onClose,
}: {
  source: StickerSource
  initialSetId?: string
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const seconds = useSeconds()
  const media = useSourceMedia(source)
  const ready = media.status === 'ready' ? media : null

  const [nat, setNat] = useState<Size | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(
    source.kind === 'attachment' ? (source.durationMs ?? null) : null,
  )
  const [square, setSquare] = useState(true)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [outline, setOutline] = useState(false)
  const [text, setText] = useState<StickerText>({ value: '', color: '#ffffff', x: 0.5, y: 0.82 })
  const [emoji, setEmoji] = useState<string | null>(null)
  const [moreEmoji, setMoreEmoji] = useState(false)
  const [segment, setSegment] = useState<{ start: number; len: number }>({
    start: 0,
    len: USER_STICKER_LIMITS.ANIMATION_MAX_MS,
  })
  const [step, setStep] = useState<'edit' | 'save'>('edit')

  // Обводка — только у статичной картинки, которую можно нарисовать на устройстве.
  const canOutline = ready?.kind === 'image' && ready.drawable

  // Первая рамка — квадрат по центру, как предлагает Telegram.
  useEffect(() => {
    if (nat && !crop) setCrop(squareCrop(nat))
  }, [nat, crop])

  useEffect(() => {
    if (durationMs === null) return
    setSegment((s) => ({
      start: Math.min(s.start, Math.max(0, durationMs - USER_STICKER_LIMITS.ANIMATION_MIN_MS)),
      len: Math.min(USER_STICKER_LIMITS.ANIMATION_MAX_MS, durationMs),
    }))
  }, [durationMs])

  const setMode = (sq: boolean): void => {
    setSquare(sq)
    if (nat) setCrop(sq ? squareCrop(nat) : fullCrop(nat))
  }

  if (media.status === 'error') {
    const reason =
      media.reason === 'type'
        ? t('tgStickers.notMedia')
        : media.reason === 'size'
          ? t('tgStickers.tooBig')
          : t('tgStickers.loadFailed')
    return (
      <MediaEditorShell title={t('tgStickers.editorTitle')} onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-white/80">{reason}</p>
          <Button type="button" variant="secondary" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </div>
      </MediaEditorShell>
    )
  }

  if (step === 'save' && ready && nat && crop) {
    return (
      <SaveStep
        media={ready}
        nat={nat}
        crop={crop}
        outline={canOutline && outline}
        text={text}
        emoji={emoji}
        segment={segment}
        source={source}
        initialSetId={initialSetId}
        onBack={() => setStep('edit')}
        onClose={onClose}
      />
    )
  }

  return (
    <MediaEditorShell
      title={t('tgStickers.editorTitle')}
      hint={t('tgStickers.editorHint')}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 text-white hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!ready || !nat || !crop}
            onClick={() => setStep('save')}
          >
            {t('tgStickers.next')}
          </Button>
        </>
      }
    >
      {ready ? (
        <CropStage
          media={ready}
          nat={nat}
          crop={crop}
          square={square}
          outline={canOutline && outline}
          text={text}
          segment={segment}
          onNat={setNat}
          onDuration={setDurationMs}
          onCrop={setCrop}
          onText={setText}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-white/70" aria-busy>
          <Loader2 className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
          <span className="sr-only">{t('tgStickers.loading')}</span>
        </div>
      )}

      <div className="mx-auto flex max-h-[40dvh] w-full max-w-xl flex-col gap-3 overflow-y-auto px-4 pt-3">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t('tgStickers.crop')}
        >
          <ToolPill
            active={square}
            onClick={() => setMode(true)}
            icon={<Square className="size-4" aria-hidden />}
          >
            {t('tgStickers.cropSquare')}
          </ToolPill>
          <ToolPill
            active={!square}
            onClick={() => setMode(false)}
            icon={<Scan className="size-4" aria-hidden />}
          >
            {t('tgStickers.cropFree')}
          </ToolPill>
          {canOutline && (
            <ToolPill
              active={outline}
              pressed
              onClick={() => setOutline((v) => !v)}
              icon={<Sparkles className="size-4" aria-hidden />}
            >
              {t('tgStickers.outline')}
            </ToolPill>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={text.value}
            onChange={(e) => setText((x) => ({ ...x, value: e.target.value.slice(0, 40) }))}
            placeholder={t('tgStickers.textPlaceholder')}
            aria-label={t('tgStickers.textPlaceholder')}
            className="h-9 flex-1 border-white/15 bg-white/10 text-white placeholder:text-white/50"
          />
          <div
            role="radiogroup"
            aria-label={t('tgStickers.textColor')}
            className="flex shrink-0 gap-1"
          >
            {TEXT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={text.color === c.hex}
                aria-label={t(c.key)}
                title={t(c.key)}
                onClick={() => setText((x) => ({ ...x, color: c.hex }))}
                className={cn(
                  'size-6 cursor-pointer rounded-full border border-white/30 outline-none focus-visible:ring-2 focus-visible:ring-white',
                  text.color === c.hex && 'ring-2 ring-white ring-offset-2 ring-offset-black',
                )}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        </div>

        {ready?.kind === 'video' && durationMs !== null && (
          <div className="grid gap-2 text-xs text-white/80 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span>
                {t('tgStickers.segmentStart')}: {seconds(segment.start)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, durationMs - USER_STICKER_LIMITS.ANIMATION_MIN_MS)}
                step={100}
                value={segment.start}
                onChange={(e) =>
                  setSegment((s) => {
                    const start = Number(e.target.value)
                    return { start, len: Math.min(s.len, durationMs - start) }
                  })
                }
                className="accent-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>
                {t('tgStickers.segmentLength')}: {seconds(segment.len)}
              </span>
              <input
                type="range"
                min={USER_STICKER_LIMITS.ANIMATION_MIN_MS}
                max={Math.max(
                  USER_STICKER_LIMITS.ANIMATION_MIN_MS,
                  Math.min(USER_STICKER_LIMITS.ANIMATION_MAX_MS, durationMs - segment.start),
                )}
                step={100}
                value={segment.len}
                onChange={(e) => setSegment((s) => ({ ...s, len: Number(e.target.value) }))}
                className="accent-primary"
              />
            </label>
          </div>
        )}
        {ready?.kind === 'gif' && (
          <p className="text-xs text-white/60">{t('tgStickers.gifWhole')}</p>
        )}

        <div>
          <p className="mb-1 text-xs text-white/60">{t('tgStickers.emoji')}</p>
          <div
            role="radiogroup"
            aria-label={t('tgStickers.emoji')}
            className="flex flex-wrap gap-1"
          >
            {[...(emoji && !QUICK_EMOJI.includes(emoji) ? [emoji] : []), ...QUICK_EMOJI].map(
              (e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={emoji === e}
                  aria-label={e}
                  onClick={() => setEmoji((cur) => (cur === e ? null : e))}
                  className={cn(
                    'flex size-9 cursor-pointer items-center justify-center rounded-lg text-xl outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white',
                    emoji === e && 'bg-white/20',
                  )}
                >
                  {e}
                </button>
              ),
            )}
            <button
              type="button"
              aria-expanded={moreEmoji}
              aria-label={t('tgStickers.emojiMore')}
              title={t('tgStickers.emojiMore')}
              onClick={() => setMoreEmoji((v) => !v)}
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-white/80 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
            >
              <Smile className="size-5" aria-hidden />
            </button>
          </div>
          {moreEmoji && (
            <EmojiPicker
              size="dock"
              searchPlaceholder={t('emojiSearch')}
              onPick={(e) => {
                setEmoji(e)
                setMoreEmoji(false)
              }}
              className="mt-2 h-64 w-full"
            />
          )}
        </div>
      </div>
    </MediaEditorShell>
  )
}

function ToolPill({
  active,
  pressed,
  onClick,
  icon,
  children,
}: {
  active: boolean
  /** Переключатель (обводка), а не выбор из группы: читалке — aria-pressed. */
  pressed?: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed ? active : undefined}
      aria-current={!pressed && active ? 'true' : undefined}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white',
        active ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

type Drag =
  | { mode: 'move'; px: number; py: number; start: CropRect }
  | { mode: 'corner'; corner: Corner }
  | { mode: 'text' }

/** Сцена кадрирования: исходник целиком, рамка с углами, надпись — тянется пальцем. */
function CropStage({
  media,
  nat,
  crop,
  square,
  outline,
  text,
  segment,
  onNat,
  onDuration,
  onCrop,
  onText,
}: {
  media: LoadedMedia
  nat: Size | null
  crop: CropRect | null
  square: boolean
  outline: boolean
  text: StickerText
  segment: { start: number; len: number }
  onNat: (s: Size) => void
  onDuration: (ms: number) => void
  onCrop: (c: CropRect) => void
  onText: (fn: (t: StickerText) => StickerText) => void
}) {
  const t = useTranslations('Chats')
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size | null>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) setStage({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    if (!stage || !nat) return null
    const s = Math.min((stage.w - STAGE_PAD * 2) / nat.w, (stage.h - STAGE_PAD * 2) / nat.h)
    return { s, left: (stage.w - nat.w * s) / 2, top: (stage.h - nat.h * s) / 2 }
  }, [stage, nat])

  const toSource = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r || !layout) return { x: 0, y: 0 }
    return {
      x: (e.clientX - r.left - layout.left) / layout.s,
      y: (e.clientY - r.top - layout.top) / layout.s,
    }
  }

  const begin = (e: ReactPointerEvent<HTMLElement>, d: Drag): void => {
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = d
  }
  const move = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current
    if (!d || !nat || !crop || !layout) return
    if (d.mode === 'move') {
      onCrop(moveCrop(d.start, (e.clientX - d.px) / layout.s, (e.clientY - d.py) / layout.s, nat))
    } else if (d.mode === 'corner') {
      onCrop(resizeCrop(crop, d.corner, toSource(e), nat, square))
    } else {
      const p = toSource(e)
      onText((x) => ({
        ...x,
        x: Math.min(0.95, Math.max(0.05, (p.x - crop.x) / crop.w)),
        y: Math.min(0.95, Math.max(0.05, (p.y - crop.y) / crop.h)),
      }))
    }
  }
  const end = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drag.current = null
  }

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!nat || !crop) return
    const step = Math.max(1, Math.min(nat.w, nat.h) * 0.02)
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    if (!dx && !dy) return
    e.preventDefault()
    if (e.shiftKey) {
      // Shift + стрелки — размер: тянем правый нижний угол.
      onCrop(
        resizeCrop(
          crop,
          'se',
          { x: crop.x + crop.w + dx, y: crop.y + crop.h + (square ? dx || dy : dy) },
          nat,
          square,
        ),
      )
    } else {
      onCrop(moveCrop(crop, dx, dy, nat))
    }
  }

  const mediaStyle: React.CSSProperties | undefined =
    nat && layout
      ? {
          position: 'absolute',
          left: layout.left,
          top: layout.top,
          width: nat.w * layout.s,
          height: nat.h * layout.s,
          maxWidth: 'none',
          filter: outline ? OUTLINE_FILTER : undefined,
        }
      : undefined
  const box =
    crop && layout
      ? {
          left: layout.left + crop.x * layout.s,
          top: layout.top + crop.y * layout.s,
          width: crop.w * layout.s,
          height: crop.h * layout.s,
        }
      : null
  const out = crop ? fitSide(crop.w, crop.h) : null
  const fontPx = box && out ? fontPxFor(out, text.value) * (box.width / out.w) : 0

  return (
    <div
      ref={stageRef}
      className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
      // Шахматка за снимком — видно прозрачность (как в редакторах стикеров).
      style={{
        backgroundImage:
          'repeating-conic-gradient(rgb(255 255 255 / 0.06) 0% 25%, transparent 0% 50%)',
        backgroundSize: '20px 20px',
      }}
    >
      {media.kind === 'video' ? (
        <SegmentVideo
          url={media.url}
          segment={segment}
          style={mediaStyle ?? { opacity: 0 }}
          onMeta={(v) => {
            onNat({ w: v.videoWidth, h: v.videoHeight })
            if (Number.isFinite(v.duration)) onDuration(Math.round(v.duration * 1000))
          }}
        />
      ) : (
        <img
          src={media.url}
          alt=""
          draggable={false}
          onLoad={(e) =>
            onNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          className="pointer-events-none"
          style={mediaStyle ?? { opacity: 0, position: 'absolute' }}
        />
      )}

      {box && (
        <div
          role="group"
          tabIndex={0}
          aria-label={t('tgStickers.cropArea')}
          onKeyDown={onKey}
          onPointerDown={(e) =>
            crop && begin(e, { mode: 'move', px: e.clientX, py: e.clientY, start: crop })
          }
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={box}
        >
          <div
            className="pointer-events-none absolute inset-0 border border-white/80"
            style={{ boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
          />
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <span
              key={corner}
              aria-hidden
              onPointerDown={(e) => begin(e, { mode: 'corner', corner })}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className={cn(
                'absolute flex size-7 touch-none items-center justify-center',
                corner === 'nw' && '-left-3.5 -top-3.5 cursor-nwse-resize',
                corner === 'se' && '-right-3.5 -bottom-3.5 cursor-nwse-resize',
                corner === 'ne' && '-right-3.5 -top-3.5 cursor-nesw-resize',
                corner === 'sw' && '-left-3.5 -bottom-3.5 cursor-nesw-resize',
              )}
            >
              <span className="size-3 rounded-full bg-white shadow" />
            </span>
          ))}
          {text.value.trim() && (
            <span
              title={t('tgStickers.textDrag')}
              onPointerDown={(e) => begin(e, { mode: 'text' })}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab whitespace-nowrap"
              style={{
                left: text.x * box.width,
                top: text.y * box.height,
                font: textFont(Math.max(8, fontPx)),
                color: text.color,
                WebkitTextStroke: `${Math.max(1, fontPx * 0.08)}px rgba(0,0,0,0.6)`,
                paintOrder: 'stroke fill',
              }}
            >
              {text.value}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Шаг «В набор…»: превью как в чате, выбор своего набора или новый — названием в одно поле.
 * После сохранения стикер сразу в панели; анимацию ждём, перечитывая набор.
 */
function SaveStep({
  media,
  nat,
  crop,
  outline,
  text,
  emoji,
  segment,
  source,
  initialSetId,
  onBack,
  onClose,
}: {
  media: LoadedMedia
  nat: Size
  crop: CropRect
  outline: boolean
  text: StickerText
  emoji: string | null
  segment: { start: number; len: number }
  source: StickerSource
  initialSetId?: string
  onBack: () => void
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const mine = useQuery({ queryKey: userStickerKeys.mine(), queryFn: fetchMyStickerSets })
  const usable = (mine.data ?? []).filter((s) => !s.removed)
  const [choice, setChoice] = useState<string | 'new' | null>(initialSetId ?? null)
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState<'idle' | 'saving' | 'processing'>('idle')
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  // Наборов нет — сразу «Новый набор»; есть — первый из них.
  const selected = choice ?? (mine.isSuccess ? (usable[0]?.id ?? 'new') : null)

  const save = useMutation({
    mutationFn: async (): Promise<MyStickerSet> => {
      setPhase('saving')
      let set: MyStickerSet | undefined =
        selected === 'new' ? undefined : usable.find((s) => s.id === selected)
      if (!set) set = await createMyStickerSetRequest({ title: title.trim() })
      const before = new Set(set.stickers.map((s) => s.id))
      const input = await buildUpload({ media, crop, outline, text, emoji, segment, source, nat })
      let result = await addStickerRequest(set.id, input)
      void qc.invalidateQueries({ queryKey: userStickerKeys.all })
      const created = result.stickers.find((s) => !before.has(s.id))
      if (created?.status === 'PROCESSING') {
        setPhase('processing')
        const until = Date.now() + POLL_LIMIT_MS
        while (alive.current && Date.now() < until) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          result = await fetchMyStickerSet(set.id)
          const now = result.stickers.find((s) => s.id === created.id)
          if (!now || now.status !== 'PROCESSING') break
        }
        const final = result.stickers.find((s) => s.id === created.id)
        if (final?.status === 'FAILED')
          throw Object.assign(new Error('failed'), { code: 'STICKER_FAILED' })
      }
      return result
    },
    onSuccess: (set) => {
      void qc.invalidateQueries({ queryKey: userStickerKeys.all })
      toast.success(t('tgStickers.saved', { title: set.title }))
      onClose()
    },
    onError: (e) => {
      setPhase('idle')
      const code = (e as { code?: string }).code
      toast.error(
        code === 'STICKER_FAILED'
          ? t('tgStickers.processingFailed')
          : tErr(code ?? 'INTERNAL_ERROR'),
      )
    },
  })

  const busy = phase !== 'idle'
  const canSave = selected !== null && (selected !== 'new' || title.trim().length > 0) && !busy

  return (
    <MediaEditorShell
      title={t('tgStickers.saveTitle')}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 text-white hover:bg-white/10 hover:text-white"
            onClick={onBack}
            disabled={busy}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('tgStickers.back')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!canSave}
            loading={busy}
            onClick={() => save.mutate()}
          >
            <Check className="size-4" aria-hidden />
            {phase === 'processing' ? t('tgStickers.processing') : t('tgStickers.save')}
          </Button>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-xl min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-2">
        <figure className="rounded-2xl bg-white/5 p-4">
          <figcaption className="mb-3 text-xs text-white/60">
            {t('tgStickers.previewInChat')}
          </figcaption>
          <div className="flex justify-end">
            <CroppedPreview
              media={media}
              nat={nat}
              crop={crop}
              outline={outline}
              text={text}
              segment={segment}
              side={CHAT_PREVIEW}
            />
          </div>
          {emoji && (
            <p className="mt-2 text-right text-lg" aria-label={t('tgStickers.emoji')}>
              {emoji}
            </p>
          )}
        </figure>

        <fieldset className="flex flex-col gap-1" disabled={busy}>
          <legend className="mb-1 text-sm font-medium">{t('tgStickers.chooseSet')}</legend>
          {mine.isPending ? (
            <div
              className="h-11 animate-pulse rounded-xl bg-white/10 motion-reduce:animate-none"
              aria-busy
            />
          ) : (
            usable.map((s) => (
              <label
                key={s.id}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-white/10',
                  selected === s.id && 'bg-white/10',
                )}
              >
                <input
                  type="radio"
                  name="sticker-set"
                  checked={selected === s.id}
                  onChange={() => setChoice(s.id)}
                  className="accent-primary"
                />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="text-xs text-white/60">
                  {t('tgStickers.setCount', { count: s.stickers.length })}
                </span>
              </label>
            ))
          )}
          <label
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-white/10',
              selected === 'new' && 'bg-white/10',
            )}
          >
            <input
              type="radio"
              name="sticker-set"
              checked={selected === 'new'}
              onChange={() => setChoice('new')}
              className="accent-primary"
            />
            <span>{t('tgStickers.newSet')}</span>
          </label>
          {selected === 'new' && (
            <Input
              autoFocus
              value={title}
              maxLength={USER_STICKER_LIMITS.TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) save.mutate()
              }}
              placeholder={t('tgStickers.newSetPlaceholder')}
              aria-label={t('tgStickers.newSetPlaceholder')}
              className="mt-1 border-white/15 bg-white/10 text-white placeholder:text-white/50"
            />
          )}
        </fieldset>
        {phase === 'processing' && (
          <p role="status" className="flex items-center gap-2 text-sm text-white/70">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {t('tgStickers.processingHint')}
          </p>
        )}
      </div>
    </MediaEditorShell>
  )
}

/** Что отправить на сервер: готовый PNG или исходник с параметрами. */
async function buildUpload(p: {
  media: LoadedMedia
  nat: Size
  crop: CropRect
  outline: boolean
  text: StickerText
  emoji: string | null
  segment: { start: number; len: number }
  source: StickerSource
}): Promise<StickerUploadInput> {
  const emoji = p.emoji ?? undefined
  const textOrNull = p.text.value.trim() ? p.text : null
  // Статичная картинка, которую можно нарисовать: всё собираем здесь, сервер только сожмёт.
  if (p.media.kind === 'image' && p.media.drawable) {
    const img = await loadImage(p.media.url)
    const file = await composeStaticSticker(img, p.crop, { outline: p.outline, text: textOrNull })
    return { file, emoji }
  }
  const overlay = (await renderTextOverlay(p.crop, textOrNull)) ?? undefined
  const crop = cropFraction(p.crop, p.nat)
  const animation =
    p.media.kind === 'video'
      ? { startMs: p.segment.start, durationMs: p.segment.len }
      : p.media.kind === 'gif'
        ? { startMs: 0, durationMs: USER_STICKER_LIMITS.ANIMATION_MAX_MS }
        : {}
  const from =
    p.source.kind === 'file' ? { file: p.source.file } : { sourceFileId: p.source.fileId }
  return { ...from, ...animation, crop, overlay, emoji }
}
