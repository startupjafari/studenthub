// Геометрия кадрирования снимка в рамке: общая для окна кадрирования (ImageCropModal) и
// редактора сторис. Снимок стоит центром в точке `place` относительно центра рамки,
// повёрнут на θ и масштабирован в `s` раз; рамка неподвижна.

export type Pt = { x: number; y: number }
export type Size = { w: number; h: number }
/** Положение снимка: смещение его центра от центра рамки и масштаб. */
export type Place = { x: number; y: number; s: number }

export const rad = (deg: number): number => (deg * Math.PI) / 180

/** Координаты указателя в системе сцены. */
export function toStage(stage: HTMLElement | null, e: { clientX: number; clientY: number }): Pt {
  const r = stage?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

/**
 * Габарит рамки w×h в осях снимка, повёрнутого на θ: сколько снимка нужно по каждой оси,
 * чтобы рамка целиком лежала на нём. Полуширина и полувысота.
 */
export function extents(w: number, h: number, theta: number): { ex: number; ey: number } {
  const c = Math.abs(Math.cos(theta))
  const s = Math.abs(Math.sin(theta))
  return { ex: (w * c + h * s) / 2, ey: (w * s + h * c) / 2 }
}

/** Наименьший масштаб, при котором снимок закрывает рамку при данном повороте. */
export function coverScale(nat: Size, frame: Size, theta: number): number {
  const { ex, ey } = extents(frame.w, frame.h, theta)
  return Math.max((2 * ex) / nat.w, (2 * ey) / nat.h)
}

/** Наибольший масштаб, при котором повёрнутый снимок целиком помещается в рамку. */
export function containScale(nat: Size, frame: Size, theta: number): number {
  const c = Math.abs(Math.cos(theta))
  const s = Math.abs(Math.sin(theta))
  return Math.min(frame.w / (nat.w * c + nat.h * s), frame.h / (nat.w * s + nat.h * c))
}

/**
 * Привести положение к допустимому: масштаб в пределах [minS, maxS], смещение — такое,
 * чтобы рамка не вылезала за снимок. Зажимается в осях повёрнутого снимка; по оси, где
 * снимок уже рамки (масштаб ниже закрывающего), он встаёт по центру.
 */
export function clampPlace(
  p: Place,
  nat: Size,
  frame: Size,
  theta: number,
  minS: number,
  maxS: number,
): Place {
  const s = Math.min(Math.max(p.s, minS), maxS)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  // Центр рамки относительно центра снимка — в осях снимка.
  const dx = -p.x
  const dy = -p.y
  let lx = dx * cos + dy * sin
  let ly = -dx * sin + dy * cos
  const { ex, ey } = extents(frame.w, frame.h, theta)
  const mx = Math.max(0, (nat.w * s) / 2 - ex)
  const my = Math.max(0, (nat.h * s) / 2 - ey)
  lx = Math.min(mx, Math.max(-mx, lx))
  ly = Math.min(my, Math.max(-my, ly))
  return { x: -(lx * cos - ly * sin), y: -(lx * sin + ly * cos), s }
}

/**
 * Нарисовать снимок в контексте так же, как его показывает CSS-трансформация на экране,
 * только в масштабе итоговой картинки: рамка шириной `frameWidth` превращается в
 * `canvas.width`. Контекст должен быть размером с итоговый кадр.
 */
export function drawPlaced(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  nat: Size,
  frameWidth: number,
  place: Place,
  theta: number,
  flip: boolean,
): void {
  const { width, height } = ctx.canvas
  const k = width / frameWidth
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(k, k)
  ctx.translate(place.x, place.y)
  ctx.rotate(theta)
  ctx.scale(flip ? -place.s : place.s, place.s)
  ctx.drawImage(image, -nat.w / 2, -nat.h / 2, nat.w, nat.h)
  ctx.restore()
}

/** CSS-трансформация снимка натурального размера `nat` на сцене `stage`. */
export function placedTransform(
  stage: Size,
  nat: Size,
  place: Place,
  deg: number,
  flip: boolean,
): string {
  return `translate(${stage.w / 2 + place.x - nat.w / 2}px, ${
    stage.h / 2 + place.y - nat.h / 2
  }px) rotate(${deg}deg) scale(${flip ? -place.s : place.s}, ${place.s})`
}
