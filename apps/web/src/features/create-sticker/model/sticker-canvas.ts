import { USER_STICKER_LIMITS } from '@studenthub/shared-schemas'

// Геометрия и отрисовка стикера в редакторе. Всё в пикселях исходника (кадр после поворота
// по EXIF — так его показывает браузер); на сервер кадрирование уходит долями кадра.

const SIDE = USER_STICKER_LIMITS.SIDE_PX

/** Прямоугольник кадрирования в пикселях исходника. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Size {
  w: number
  h: number
}

/** Угол рамки, за который тянут. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** Надпись поверх стикера: центр — доли итогового кадра. */
export interface StickerText {
  value: string
  color: string
  x: number
  y: number
}

/** Толщина обводки на итоговом стикере, px (у Telegram — около 3 % стороны). */
export const OUTLINE_PX = 14
/** Самая маленькая рамка — доля короткой стороны исходника. */
const MIN_CROP_FRACTION = 0.1

/** Стороны итогового стикера: большая — 512 px, как сделает сервер. */
export function fitSide(w: number, h: number): Size {
  const k = SIDE / Math.max(w, h, 1)
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** Наибольший квадрат по центру кадра. */
export function squareCrop(nat: Size): CropRect {
  const side = Math.min(nat.w, nat.h)
  return { x: (nat.w - side) / 2, y: (nat.h - side) / 2, w: side, h: side }
}

/** Кадр целиком. */
export function fullCrop(nat: Size): CropRect {
  return { x: 0, y: 0, w: nat.w, h: nat.h }
}

function minSide(nat: Size): number {
  return Math.max(8, Math.min(nat.w, nat.h) * MIN_CROP_FRACTION)
}

/** Сдвинуть рамку, не выпуская её за кадр. */
export function moveCrop(c: CropRect, dx: number, dy: number, nat: Size): CropRect {
  return {
    ...c,
    x: Math.min(Math.max(0, c.x + dx), nat.w - c.w),
    y: Math.min(Math.max(0, c.y + dy), nat.h - c.h),
  }
}

/**
 * Потянуть угол рамки в точку `p` (пиксели исходника). Противоположный угол стоит на месте;
 * квадратная рамка остаётся квадратом. Рамка не выходит за кадр и не меньше 10 % стороны.
 */
export function resizeCrop(
  c: CropRect,
  corner: Corner,
  p: { x: number; y: number },
  nat: Size,
  square: boolean,
): CropRect {
  const west = corner === 'nw' || corner === 'sw'
  const north = corner === 'nw' || corner === 'ne'
  // Неподвижный угол.
  const ax = west ? c.x + c.w : c.x
  const ay = north ? c.y + c.h : c.y
  const min = minSide(nat)
  // Сколько места до края кадра в сторону, куда тянут.
  const roomX = west ? ax : nat.w - ax
  const roomY = north ? ay : nat.h - ay
  let w = Math.min(Math.max(min, west ? ax - p.x : p.x - ax), roomX)
  let h = Math.min(Math.max(min, north ? ay - p.y : p.y - ay), roomY)
  if (square) {
    const side = Math.min(Math.max(w, h), roomX, roomY)
    w = side
    h = side
  }
  return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h }
}

/** Кадрирование долями кадра — так его принимает сервер (cropX…cropH). */
export function cropFraction(
  c: CropRect,
  nat: Size,
): { x: number; y: number; w: number; h: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const x = clamp(c.x / nat.w)
  const y = clamp(c.y / nat.h)
  return { x, y, w: Math.min(clamp(c.w / nat.w), 1 - x), h: Math.min(clamp(c.h / nat.h), 1 - y) }
}

/** Размер шрифта надписи: ~13 % высоты стикера, но строка влезает в 90 % ширины. */
export function textFontPx(out: Size, value: string, measure: (font: string) => number): number {
  let size = Math.round(Math.min(out.w, out.h) * 0.13)
  while (size > 12 && measure(textFont(size)) > out.w * 0.9) size -= 2
  return size
}

let measureCtx: CanvasRenderingContext2D | null = null

/** Размер шрифта надписи для превью на экране — тем же расчётом, что при сохранении. */
export function fontPxFor(out: Size, value: string): number {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  const ctx = measureCtx
  return textFontPx(out, value, (font) => {
    if (!ctx) return 0
    ctx.font = font
    return ctx.measureText(value).width
  })
}

export function textFont(px: number): string {
  return `800 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
}

/** Надпись: заливка цветом и обводка контрастным — читается на любом фоне. */
export function drawText(ctx: CanvasRenderingContext2D, text: StickerText, out: Size): void {
  const value = text.value.trim()
  if (!value) return
  const px = textFontPx(out, value, (font) => {
    ctx.font = font
    return ctx.measureText(value).width
  })
  ctx.save()
  ctx.font = textFont(px)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(2, px * 0.16)
  ctx.strokeStyle = isLight(text.color) ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)'
  const x = text.x * out.w
  const y = text.y * out.h
  ctx.strokeText(value, x, y)
  ctx.fillStyle = text.color
  ctx.fillText(value, x, y)
  ctx.restore()
}

/** Светлый ли цвет #rrggbb (для контрастной обводки надписи). */
export function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return true
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 150
}

function canvas(size: Size): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size.w
  c.height = size.h
  return c
}

function toPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'),
  )
}

/**
 * Белая обводка по контуру прозрачности (как у Telegram): силуэт картинки рисуется по кругу
 * со сдвигом на толщину обводки, заливается белым, сверху — сама картинка. У непрозрачной
 * картинки получается белая рамка со скруглёнными углами.
 */
function drawWithOutline(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  pad: number,
): void {
  const ring = canvas({ w: ctx.canvas.width, h: ctx.canvas.height })
  const r = ring.getContext('2d')
  if (!r) return
  const steps = 24
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    r.drawImage(layer, pad + Math.cos(a) * pad, pad + Math.sin(a) * pad)
  }
  r.globalCompositeOperation = 'source-in'
  r.fillStyle = '#ffffff'
  r.fillRect(0, 0, ring.width, ring.height)
  ctx.drawImage(ring, 0, 0)
  ctx.drawImage(layer, pad, pad)
}

/**
 * Готовый статичный стикер: кадр, обводка, надпись — PNG в размер стикера (большая сторона
 * 512 px). В WebP его переведёт сервер.
 */
export async function composeStaticSticker(
  image: CanvasImageSource,
  crop: CropRect,
  opts: { outline: boolean; text: StickerText | null },
): Promise<Blob> {
  const out = fitSide(crop.w, crop.h)
  const result = canvas(out)
  const ctx = result.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.imageSmoothingQuality = 'high'
  const pad = opts.outline ? OUTLINE_PX : 0
  // Картинка внутри — меньше на обводку с каждой стороны.
  const inner = { w: Math.max(1, out.w - pad * 2), h: Math.max(1, out.h - pad * 2) }
  const layer = canvas(inner)
  const l = layer.getContext('2d')
  if (!l) throw new Error('canvas')
  l.imageSmoothingQuality = 'high'
  l.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, inner.w, inner.h)
  if (pad > 0) drawWithOutline(ctx, layer, pad)
  else ctx.drawImage(layer, 0, 0)
  if (opts.text) drawText(ctx, opts.text, out)
  return toPng(result)
}

/** Надпись поверх анимации — прозрачный PNG в размер стикера; без надписи — null. */
export async function renderTextOverlay(
  crop: CropRect,
  text: StickerText | null,
): Promise<Blob | null> {
  if (!text || !text.value.trim()) return null
  const out = fitSide(crop.w, crop.h)
  const c = canvas(out)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  drawText(ctx, text, out)
  return toPng(c)
}
