// Полёт снимка между миниатюрой и просмотрщиком (как в Telegram): открытие вырастает из
// пузыря, закрытие садится обратно в него.
//
// Летит сам элемент просмотрщика (<img>/<video>), а не копия: копию пришлось бы снова
// грузить и декодировать, и первый кадр полёта был бы пустым. Элементу на время полёта
// ставится трансформация «моя видимая часть — там, где миниатюра» и обрезка по рамке
// миниатюры: миниатюра в сетке альбома — квадратный кроп снимка, и честный полёт — это
// снимок, увеличенный до «cover» плитки и обрезанный по ней, а не сплющенный в квадрат.
//
// Анимация — Web Animations API: она не трогает инлайн-стили, которые пишут жесты и поворот,
// и по окончании элемент возвращается ровно к ним. Длительности — токены `MOTION`
// (DESIGN_SYSTEM §7): вход — `modal`, уход — `exit`.

import { MOTION } from '../lib/motion'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const boxOf = (r: DOMRect): Box => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
})

/** Видимая часть медиа с `object-contain` внутри его коробки: по центру, в своих пропорциях. */
export function containedBox(box: Box, ratio: number): Box {
  if (!(ratio > 0) || box.width <= 0 || box.height <= 0) return box
  const boxRatio = box.width / box.height
  const width = ratio > boxRatio ? box.width : box.height * ratio
  const height = ratio > boxRatio ? box.width / ratio : box.height
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  }
}

/** Пропорции медиа: по самим пикселям, если они уже есть, иначе — по размерам с сервера. */
export function mediaRatio(
  el: HTMLElement,
  fallback?: { width?: number | null; height?: number | null } | null,
): number | null {
  if (el instanceof HTMLImageElement && el.naturalWidth > 0 && el.naturalHeight > 0) {
    return el.naturalWidth / el.naturalHeight
  }
  if (el instanceof HTMLVideoElement && el.videoWidth > 0 && el.videoHeight > 0) {
    return el.videoWidth / el.videoHeight
  }
  if (fallback?.width && fallback.height) return fallback.width / fallback.height
  return null
}

/** Целиком ли рамка в окне: наполовину спрятанная миниатюра — не место для посадки. */
function fullyVisible(b: Box): boolean {
  return (
    b.width > 0 &&
    b.height > 0 &&
    b.top >= 0 &&
    b.left >= 0 &&
    b.top + b.height <= window.innerHeight &&
    b.left + b.width <= window.innerWidth
  )
}

/** Видна ли рамка хоть краем: совсем ушедшая из окна миниатюра — посадки нет вовсе. */
function partlyVisible(b: Box): boolean {
  return (
    b.width > 0 &&
    b.height > 0 &&
    b.top < window.innerHeight &&
    b.left < window.innerWidth &&
    b.top + b.height > 0 &&
    b.left + b.width > 0
  )
}

/** Радиус скругления рамки миниатюры (берём верхний левый — у плиток они одинаковы). */
function radiusOf(el: Element): number {
  const v = parseFloat(getComputedStyle(el).borderTopLeftRadius)
  return Number.isFinite(v) ? v : 0
}

// Тип, а не интерфейс: кадр уходит в `Element.animate`, а тот ждёт запись с индексной
// сигнатурой — интерфейс к ней неявно не приводится.
type Frame = {
  transform: string
  clipPath: string
  opacity?: number
}

/**
 * Кадр полёта: элемент с коробкой `el` (без трансформаций) и видимой частью `content`
 * показывается так, будто его видимая часть занимает `target`, обрезанная по `clip`.
 *
 * Масштаб равномерный («cover» видимой части по рамке): неравномерный сплющил бы снимок
 * в квадрат плитки. Обрезка — в собственных координатах элемента, то есть ДО трансформации,
 * поэтому делится на масштаб.
 */
function frameFor(el: Box, content: Box, target: Box, clip: Box, radius: number): Frame {
  const scale = Math.max(target.width / content.width, target.height / content.height)
  const cx = content.left + content.width / 2
  const cy = content.top + content.height / 2
  const ex = el.left + el.width / 2
  const ey = el.top + el.height / 2
  const tx = clip.left + clip.width / 2
  const ty = clip.top + clip.height / 2
  // Центр видимой части едет в центр рамки; трансформация считается от центра элемента
  // (transform-origin по умолчанию), поэтому сдвиг центра видимой части учитываем отдельно.
  const dx = tx - (ex + (cx - ex) * scale)
  const dy = ty - (ey + (cy - ey) * scale)
  // Что из видимой части остаётся в рамке — в координатах элемента до масштаба.
  const visibleW = Math.min(content.width, clip.width / scale)
  const visibleH = Math.min(content.height, clip.height / scale)
  const left = content.left - el.left + (content.width - visibleW) / 2
  const top = content.top - el.top + (content.height - visibleH) / 2
  const right = el.width - left - visibleW
  const bottom = el.height - top - visibleH
  return {
    transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
    clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius / scale}px)`,
  }
}

/** Кадр «как есть»: без сдвига, обрезка только по видимой части (пустые поля contain). */
function restFrame(el: Box, content: Box): Frame {
  const left = content.left - el.left
  const top = content.top - el.top
  return {
    transform: 'translate(0px, 0px) scale(1)',
    clipPath: `inset(${top}px ${el.width - left - content.width}px ${
      el.height - top - content.height
    }px ${left}px round 0px)`,
  }
}

/**
 * Вырасти из миниатюры. Возвращает null, если лететь неоткуда (миниатюры нет или она вне
 * окна, пропорции неизвестны) — тогда просмотрщик просто проявляется.
 */
export function flyFromOrigin(
  media: HTMLElement,
  origin: HTMLElement | null,
  ratio: number | null,
): Animation | null {
  if (!origin || !ratio || typeof media.animate !== 'function') return null
  const from = boxOf(origin.getBoundingClientRect())
  if (!partlyVisible(from)) return null
  const el = boxOf(media.getBoundingClientRect())
  if (el.width <= 0 || el.height <= 0) return null
  const content = containedBox(el, ratio)
  return media.animate(
    [frameFor(el, content, from, from, radiusOf(origin)), restFrame(el, content)],
    { duration: MOTION.modal, easing: MOTION.ease },
  )
}

/**
 * Сесть обратно в миниатюру (или улететь за край по направлению смахивания, если садиться
 * некуда). `layer` — слой жестов: его зум и сдвиг сначала переносятся в стартовый кадр
 * полёта, потом снимаются, иначе полёт считался бы от уже сдвинутого места.
 *
 * Возвращает анимацию, по окончании которой просмотрщик размонтируется; null — лететь
 * не из чего, закрываться можно сразу.
 */
export function flyToOrigin({
  media,
  layer,
  origin,
  ratio,
  direction,
}: {
  media: HTMLElement
  layer: HTMLElement | null
  origin: HTMLElement | null
  ratio: number | null
  /** Смахнули вверх (-1) или вниз (1); нет — закрыли кнопкой, Esc или кликом. */
  direction?: 1 | -1
}): Animation | null {
  if (!ratio || typeof media.animate !== 'function') return null
  // Где снимок виден сейчас — с зумом, сдвигом и утаскиванием слоя.
  const now = containedBox(boxOf(media.getBoundingClientRect()), ratio)
  if (layer) layer.style.transform = ''
  const el = boxOf(media.getBoundingClientRect())
  if (el.width <= 0 || el.height <= 0) return null
  const content = containedBox(el, ratio)
  const start = frameFor(el, content, now, now, 0)

  const target = origin ? boxOf(origin.getBoundingClientRect()) : null
  if (target && partlyVisible(target)) {
    const end: Frame = frameFor(el, content, target, target, radiusOf(origin as HTMLElement))
    // Миниатюра частично под шапкой или полем ввода — снимок тает по пути, а не ложится
    // поверх чужого слоя (так делает и Telegram).
    if (!fullyVisible(target)) end.opacity = 0
    return media.animate(
      [
        { ...start, opacity: 1 },
        { opacity: 1, ...end },
      ],
      {
        duration: MOTION.exit,
        easing: MOTION.ease,
        fill: 'forwards',
      },
    )
  }

  // Садиться некуда: смахнутый кадр продолжает путь за край, закрытый кнопкой — тает на месте.
  const shift = direction ? direction * window.innerHeight * 0.5 : 0
  const away: Box = { ...now, top: now.top + shift }
  return media.animate(
    [
      { ...start, opacity: 1 },
      { ...frameFor(el, content, away, away, 0), opacity: 0 },
    ],
    { duration: MOTION.exit, easing: MOTION.ease, fill: 'forwards' },
  )
}
