'use client'

import { MOTION, createSpring, prefersReducedMotion } from '../../../shared/lib'

// Летящая реакция (Telegram): поставленный эмодзи вылетает из точки нажатия — пункт меню,
// место двойного клика, кнопка быстрой реакции — и по дуге садится в свой чип под пузырём;
// в момент посадки чип «подпрыгивает», вокруг него разлетаются искры.
//
// Своими средствами, без ассетов Telegram (их анимации — под GPL): полёт — две пружины
// (spring.ts, по пружине на ось — так велит §3 apple-design: у осей разные скорости),
// подпрыгивание и искры — Web Animations с токенами MOTION. Слой полёта — фиксированный
// узел в body, а не элемент ленты: летящий эмодзи пересекает границы пузыря, ленты и меню.
//
// Чип ищется в DOM по строке `msg-<id>` и атрибуту `data-reaction-chip`: реакция ставится
// оптимистично, и к следующему кадру чип уже в разметке. Нет чипа (сообщение уехало из
// виртуального окна, реакцию тут же сняли) — лететь некуда, ничего не происходит.
//
// prefers-reduced-motion: ни полёта, ни искр — чип просто появляется, как без анимации.

export interface FlightPoint {
  x: number
  y: number
}

/** Сколько кадров ждать, пока оптимистичный чип появится в разметке. */
const SEEK_FRAMES = 6
/** Ближе этого от чипа — лететь незачем (клик по самому чипу): только посадка. */
const MIN_FLIGHT_PX = 24
/** Стартовый размер летящего эмодзи — как в ряду реакций меню; садится в размер чипа. */
const FLYER_FONT_PX = 28
/** Подброс вверх в начале полёта, px/с: без него путь — прямая, а не дуга. */
const ARC_LIFT = 900
/** Страховка: полёт не может длиться дольше, даже если пружина почему-то не села. */
const FLIGHT_TIMEOUT_MS = 1200
const SPARKS = 8
/**
 * Слой полёта — `z-50` шкалы (DESIGN_SYSTEM §5.3), как у меню сообщения и открытого чата:
 * своего слоя между ними не заводим. Узел добавляется в body последним, поэтому при равном
 * z лежит поверх уходящего меню; нажатий он не ловит.
 */
const FLIGHT_Z = '50'

export const centerOf = (el: Element): FlightPoint => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function findChip(messageId: string, emoji: string): HTMLElement | null {
  const row = document.getElementById(`msg-${messageId}`)
  if (!row) return null
  // Сравнение через dataset, а не селектором: эмодзи в селекторе пришлось бы экранировать.
  for (const el of row.querySelectorAll<HTMLElement>('[data-reaction-chip]')) {
    if (el.dataset.reactionChip === emoji) return el
  }
  return null
}

/** Короткое «подпрыгивание» чипа: посадка своей реакции или пришедшая чужая. */
export function popReactionChip(chip: HTMLElement): void {
  if (prefersReducedMotion() || typeof chip.animate !== 'function') return
  chip.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.22)', offset: 0.35 },
      { transform: 'scale(0.96)', offset: 0.7 },
      { transform: 'scale(1)' },
    ],
    { duration: MOTION.large, easing: MOTION.ease },
  )
}

/** Искры вокруг точки посадки: кружки цвета чипа разлетаются и гаснут. */
function burst(at: FlightPoint, color: string): void {
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'fixed',
    left: `${at.x}px`,
    top: `${at.y}px`,
    width: '0',
    height: '0',
    zIndex: FLIGHT_Z,
    pointerEvents: 'none',
  })
  document.body.appendChild(layer)
  const done: Promise<unknown>[] = []
  for (let i = 0; i < SPARKS; i += 1) {
    const spark = document.createElement('span')
    const size = i % 2 === 0 ? 5 : 3
    Object.assign(spark.style, {
      position: 'absolute',
      left: `${-size / 2}px`,
      top: `${-size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '9999px',
      background: color,
    })
    layer.appendChild(spark)
    // Равномерно по кругу с лёгким сдвигом, чтобы искры не стояли ровной «звездой».
    const angle = (i / SPARKS) * Math.PI * 2 + (i % 3) * 0.2
    const dist = 16 + (i % 3) * 5
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist
    done.push(
      spark.animate(
        [
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0 },
        ],
        { duration: MOTION.large, easing: MOTION.ease, fill: 'forwards' },
      ).finished,
    )
  }
  void Promise.allSettled(done).then(() => layer.remove())
}

function land(chip: HTMLElement, glyph: HTMLElement): void {
  glyph.style.visibility = ''
  popReactionChip(chip)
  burst(centerOf(glyph), getComputedStyle(chip).color)
}

function launch(chip: HTMLElement, emoji: string, from: FlightPoint): void {
  const glyph = chip.querySelector<HTMLElement>('[data-reaction-glyph]') ?? chip
  const target = centerOf(glyph)
  if (Math.hypot(target.x - from.x, target.y - from.y) < MIN_FLIGHT_PX) {
    land(chip, glyph)
    return
  }

  const flyer = document.createElement('span')
  flyer.textContent = emoji
  flyer.setAttribute('aria-hidden', 'true')
  Object.assign(flyer.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    zIndex: FLIGHT_Z,
    pointerEvents: 'none',
    fontSize: `${FLYER_FONT_PX}px`,
    lineHeight: '1',
    willChange: 'transform',
  })
  document.body.appendChild(flyer)
  const half = { w: flyer.offsetWidth / 2, h: flyer.offsetHeight / 2 }
  // Итоговый масштаб — размер глифа чипа к стартовому размеру.
  const endScale = Math.min(1, (glyph.getBoundingClientRect().height || 14) / FLYER_FONT_PX)
  const startDist = Math.hypot(target.x - from.x, target.y - from.y)
  glyph.style.visibility = 'hidden'

  let finished = false
  const paint = (now: FlightPoint): void => {
    const x = sx.value
    const y = sy.value
    const left = Math.hypot(now.x - x, now.y - y)
    // Масштаб — по пройденной доле пути: эмодзи «уменьшается в чип» по мере подлёта.
    const k = Math.min(1, left / startDist)
    const scale = endScale + (1 - endScale) * k
    flyer.style.transform = `translate(${x - half.w}px, ${y - half.h}px) scale(${scale})`
  }
  const finish = (): void => {
    if (finished) return
    finished = true
    window.clearTimeout(timeout)
    sx.stop()
    sy.stop()
    flyer.remove()
    // Строку могли размонтировать на лету (виртуализация) — тогда садиться некуда.
    if (chip.isConnected) land(chip, glyph)
  }
  // Садимся, когда успокоились обе оси: пружина одной оси могла сесть и снова сдвинуться
  // вслед за прокруткой ленты.
  const rest = (): void => {
    if (!sx.animating && !sy.animating) finish()
  }
  const retarget = (): void => {
    // Лента могла прокрутиться за время полёта — цель едет вместе с чипом, пружины
    // подхватывают её без рывка (скорость сохраняется).
    if (!chip.isConnected) return finish()
    const now = centerOf(glyph)
    if (Math.abs(now.x - sx.value) > 0.5) sx.to(now.x)
    if (Math.abs(now.y - sy.value) > 0.5) sy.to(now.y)
    paint(now)
  }
  const sx = createSpring({
    from: from.x,
    damping: 0.9,
    response: 0.42,
    onChange: retarget,
    onRest: rest,
  })
  const sy = createSpring({
    from: from.y,
    damping: 0.85,
    response: 0.42,
    onChange: retarget,
    onRest: rest,
  })
  const timeout = window.setTimeout(finish, FLIGHT_TIMEOUT_MS)
  paint(target)
  sx.to(target.x)
  sy.to(target.y, -ARC_LIFT)
}

/**
 * Запустить полёт реакции к её чипу под сообщением. Вызывать сразу после оптимистичной
 * постановки — чип ищется в ближайших кадрах. Только для постановки: снятие не летит.
 */
export function flyReaction({
  messageId,
  emoji,
  from,
}: {
  messageId: string
  emoji: string
  from: FlightPoint
}): void {
  if (typeof window === 'undefined' || prefersReducedMotion()) return
  let frames = 0
  const seek = (): void => {
    const chip = findChip(messageId, emoji)
    if (chip) {
      launch(chip, emoji, from)
      return
    }
    frames += 1
    if (frames < SEEK_FRAMES) requestAnimationFrame(seek)
  }
  requestAnimationFrame(seek)
}

/**
 * Подпрыгнуть чипами пришедших реакций (чужие голоса на моё сообщение). Чип мог только что
 * появиться — ищем его в ближайших кадрах, как и при полёте.
 */
export function popReactionChips(messageId: string, emojis: ReadonlySet<string>): void {
  if (typeof window === 'undefined' || prefersReducedMotion() || emojis.size === 0) return
  let frames = 0
  const left = new Set(emojis)
  const seek = (): void => {
    for (const emoji of [...left]) {
      const chip = findChip(messageId, emoji)
      if (!chip) continue
      popReactionChip(chip)
      left.delete(emoji)
    }
    frames += 1
    if (left.size > 0 && frames < SEEK_FRAMES) requestAnimationFrame(seek)
  }
  requestAnimationFrame(seek)
}
