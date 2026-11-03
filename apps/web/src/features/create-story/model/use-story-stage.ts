'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clampPlace,
  containScale,
  coverScale,
  drawPlaced,
  rad,
  useCropGestures,
  type Place,
  type Size,
} from '../../../shared/lib'

/** Кадр сторис: 9:16, итоговый снимок — как экран телефона в портрете. */
export const STORY_ASPECT = 9 / 16
export const STORY_WIDTH = 1080
const STORY_HEIGHT = 1920
/** Отступ кадра от краёв сцены, px: за кадром видно, что ещё есть на снимке. */
const FRAME_PAD = 24
/** Во сколько раз можно приблизить сверх «снимок едва закрывает кадр». */
const MAX_ZOOM = 10
/** Размытие фона под фото «целиком», px итогового кадра. На экране — в масштабе кадра. */
export const STORY_BLUR_PX = 48

/**
 * Фильтры фото: CSS-фильтр, один и тот же на экране и в canvas при сборке кадра. Набор
 * короткий — пресеты, а не ползунки: сторис живут сутки, тонкая цветокоррекция им ни к чему.
 */
export const STORY_PHOTO_FILTERS = {
  none: '',
  vivid: 'saturate(1.5) contrast(1.08)',
  warm: 'sepia(0.25) saturate(1.3) hue-rotate(-8deg)',
  cool: 'saturate(1.1) hue-rotate(12deg) brightness(1.04)',
  fade: 'contrast(0.85) brightness(1.08) saturate(0.75)',
  mono: 'grayscale(1) contrast(1.1)',
} as const
export type StoryPhotoFilter = keyof typeof STORY_PHOTO_FILTERS

let canvasFilter: boolean | null = null
/**
 * Умеет ли canvas фильтры (`ctx.filter`). Без них фильтр не запечётся в кадр, и после
 * публикации фото выглядело бы не так, как в редакторе, — такие фильтры не предлагаем.
 */
export function canvasFilterSupported(): boolean {
  if (canvasFilter === null) {
    const ctx = document.createElement('canvas').getContext('2d')
    canvasFilter = ctx !== null && 'filter' in ctx
  }
  return canvasFilter
}

/** Самый большой кадр 9:16, что влезает в сцену с отступами. */
function fitFrame(stage: Size): Size {
  const w = Math.max(0, Math.min(stage.w - FRAME_PAD * 2, (stage.h - FRAME_PAD * 2) * STORY_ASPECT))
  return { w, h: w / STORY_ASPECT }
}

/**
 * Сцена редактора сторис: кадр 9:16 по центру и фото под ним, которое двигают, приближают
 * (колесо, щипок), поворачивают и отражают — как в окне кадрирования, только прямо на
 * кадре, поверх которого лежат элементы.
 *
 * Два режима: «заполнить» — фото всегда закрывает кадр (как при кадрировании аватара);
 * «целиком» — фото можно уменьшить до вписанного, а пустоту вокруг закрывает оно же,
 * размытое. Итоговый JPEG собирается в браузере только при публикации (`exportPhoto`):
 * пока автор правит кадр, на сервер ничего не уходит.
 */
export function useStoryStage(photo: File | null) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [stage, setStage] = useState<Size | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [nat, setNat] = useState<Size | null>(null)
  const [place, setPlace] = useState<Place>({ x: 0, y: 0, s: 1 })
  const [quarter, setQuarter] = useState(0)
  const [angle, setAngle] = useState(0)
  const [flip, setFlip] = useState(false)
  const [whole, setWhole] = useState(false)
  const [filter, setFilter] = useState<StoryPhotoFilter>('none')
  // Поворот, отражение и смена режима — плавно; жесты — без анимации, иначе снимок
  // отставал бы от пальца.
  const [animate, setAnimate] = useState(false)

  const frame = useMemo(() => (stage ? fitFrame(stage) : null), [stage])
  const deg = quarter * 90 + angle
  const theta = rad(deg)

  // Сцена меняет размер вместе с окном.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r || r.width === 0 || r.height === 0) return
      setStage({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Кадр вырос или сжался — снимок масштабируется вместе с ним: в кадре остаётся та же
  // область, а не та же точка в пикселях.
  const frameWidth = frame?.w ?? 0
  const prevFrameWidth = useRef(frameWidth)
  useEffect(() => {
    const prev = prevFrameWidth.current
    prevFrameWidth.current = frameWidth
    if (prev <= 0 || frameWidth <= 0 || prev === frameWidth) return
    const k = frameWidth / prev
    setPlace((p) => ({ x: p.x * k, y: p.y * k, s: p.s * k }))
  }, [frameWidth])

  // Новое фото — всё с нуля.
  const placed = useRef(false)
  useEffect(() => {
    placed.current = false
    setNat(null)
    setQuarter(0)
    setAngle(0)
    setFlip(false)
    setWhole(false)
    setFilter('none')
    if (!photo) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(photo)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])

  const normalize = useCallback(
    (p: Place): Place => {
      if (!nat || !frame) return p
      const cover = coverScale(nat, frame, theta)
      const floor = whole ? Math.min(cover, containScale(nat, frame, theta)) : cover
      return clampPlace(p, nat, frame, theta, floor, cover * MAX_ZOOM)
    },
    [nat, frame, theta, whole],
  )

  // Первая раскладка: фото по центру и ровно закрывает кадр. Один раз на фото: дальше
  // положение меняют только жесты и инструменты.
  useEffect(() => {
    if (placed.current || !nat || !frame) return
    placed.current = true
    setPlace({ x: 0, y: 0, s: coverScale(nat, frame, 0) })
  }, [nat, frame])

  // Угол, кадр или режим изменились — поджимаем положение под новые границы.
  useEffect(() => {
    setPlace((p) => normalize(p))
  }, [normalize])

  const { interacting, setInteracting, handlers } = useCropGestures({
    stageRef,
    stage,
    place,
    setPlace,
    normalize,
    enabled: nat !== null,
    onStart: () => setAnimate(false),
  })

  function onImageLoad(): void {
    const el = imgRef.current
    if (el) setNat({ w: el.naturalWidth, h: el.naturalHeight })
  }

  function rotate90(): void {
    setAnimate(true)
    setQuarter((q) => (q + 3) % 4) // против часовой, как кнопка в Telegram
  }

  function toggleFlip(): void {
    setAnimate(true)
    setFlip((f) => !f)
  }

  /** «Целиком»: фото вписывается в кадр с размытым фоном; повторно — снова заполняет кадр. */
  function toggleWhole(): void {
    if (!nat || !frame) return
    setAnimate(true)
    const next = !whole
    setWhole(next)
    setPlace({
      x: 0,
      y: 0,
      s: next ? containScale(nat, frame, theta) : coverScale(nat, frame, theta),
    })
  }

  // Приближение для ползунка — во сколько раз фото больше «ровно закрывает кадр».
  const cover = nat && frame ? coverScale(nat, frame, theta) : 1
  const zoom = place.s / cover
  const minZoom = nat && frame && whole ? Math.min(1, containScale(nat, frame, theta) / cover) : 1

  /** Приблизить к центру кадра: точка под центром остаётся на месте. */
  function setZoom(next: number): void {
    setAnimate(false)
    setPlace((p) => {
      const k = (next * cover) / p.s
      return normalize({ x: p.x * k, y: p.y * k, s: p.s * k })
    })
  }

  /** Кадр 1080×1920 в JPEG — ровно то, что автор видит в рамке. */
  async function exportPhoto(): Promise<File> {
    const el = imgRef.current
    if (!el || !nat || !frame) throw new Error('фото ещё не загружено')
    const canvas = document.createElement('canvas')
    canvas.width = STORY_WIDTH
    canvas.height = STORY_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d недоступен')
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
    // Фильтр есть не во всех движках (`filter` у контекста) — без него кадр уходит без
    // цветокоррекции, а размытый фон просто темнее.
    const canFilter = 'filter' in ctx
    const tone = STORY_PHOTO_FILTERS[filter]
    if (whole) {
      // Фон — то же фото «заполнить кадр», размытое и притемнённое, как на сцене.
      if (canFilter) ctx.filter = `blur(${STORY_BLUR_PX}px) ${tone}`.trim()
      drawPlaced(ctx, el, nat, frame.w, { x: 0, y: 0, s: coverScale(nat, frame, 0) }, 0, false)
      if (canFilter) ctx.filter = 'none'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT)
    }
    if (canFilter) ctx.filter = tone || 'none'
    drawPlaced(ctx, el, nat, frame.w, place, theta, flip)
    if (canFilter) ctx.filter = 'none'
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (!blob) throw new Error('не удалось собрать кадр')
    return new File([blob], 'story.jpg', { type: 'image/jpeg' })
  }

  return {
    stageRef,
    imgRef,
    stage,
    frame,
    url,
    nat,
    place,
    deg,
    angle,
    flip,
    whole,
    filter,
    zoom,
    minZoom,
    maxZoom: MAX_ZOOM,
    animate,
    interacting,
    handlers,
    ready: nat !== null && frame !== null,
    onImageLoad,
    rotate90,
    toggleFlip,
    toggleWhole,
    setFilter,
    setZoom,
    setAngle,
    onRulerStart: () => {
      setAnimate(false)
      setInteracting(true)
    },
    onRulerEnd: () => setInteracting(false),
    exportPhoto,
  }
}

export type StoryStage = ReturnType<typeof useStoryStage>
