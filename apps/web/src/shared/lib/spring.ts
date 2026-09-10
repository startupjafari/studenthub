// Пружинная анимация и физика жестов (apple-design §4–§6, §9).
//
// Почему не CSS-переход. Переход задаёт длительность и кривую заранее, поэтому он не умеет
// двух вещей, без которых жест не ощущается живым: стартовать от текущего положения
// (а не от логического) и продолжать движение с той скоростью, с какой палец его отпустил.
// Пружина умеет обе: у неё нет длительности, есть состояние (позиция + скорость), и смена
// цели на лету не создаёт разрыва.
//
// Почему без внешней библиотеки. Motion/Framer дали бы то же самое, но новая зависимость —
// стоп-точка проекта (AGENTS.md), а нужного здесь — полторы формулы и rAF-цикл.

/** Потолок отработки за один кадр: после возврата из фонового таба dt может быть в секундах. */
const MAX_FRAME_MS = 64
/** Фиксированный шаг интегрирования. Мельче кадра — явная схема остаётся устойчивой. */
const STEP_MS = 1000 / 120

/** Пороги покоя: ближе этого к цели и медленнее этого — считаем, что пружина села. */
const REST_DISTANCE = 0.1
const REST_VELOCITY = 0.1

export interface SpringOptions {
  /** Стартовое значение. */
  from: number
  /**
   * Коэффициент затухания. `1` — критическое (без перелёта, спокойно), `<1` — с перелётом.
   * Перелёт уместен только там, где жест сам нёс инерцию: брошенная карточка, флик шторки.
   */
  damping?: number
  /**
   * Отзывчивость в секундах — насколько быстро значение доходит до цели. Это НЕ длительность:
   * у пружины её нет, время выхода следует из параметров.
   */
  response?: number
  onChange: (value: number) => void
  onRest?: () => void
}

export interface SpringHandle {
  /** Текущее значение (позиция на экране «прямо сейчас»). */
  readonly value: number
  /** Текущая скорость, px/с. */
  readonly velocity: number
  readonly animating: boolean
  /** Мгновенно поставить значение и погасить движение (перехват пальцем). */
  set(value: number): void
  /**
   * Перенацелить пружину. Скорость по умолчанию сохраняется — это и есть отсутствие
   * «кирпичной стены» при развороте жеста; передайте `velocity`, чтобы подхватить скорость
   * пальца в момент отпускания (§5).
   */
  to(target: number, velocity?: number): void
  stop(): void
}

/**
 * Пружина на одну ось. Двумерное движение собирают из двух независимых пружин: одна общая
 * на расстояние рассинхронизируется, когда по X и Y разные скорости (§3).
 */
export function createSpring(options: SpringOptions): SpringHandle {
  const damping = options.damping ?? 1
  const response = options.response ?? 0.4
  // Перевод «затухание + отзывчивость» в коэффициенты уравнения (масса принята за 1):
  // собственная частота ω = 2π / T, жёсткость = ω², сопротивление = 2ζω.
  const omega = (2 * Math.PI) / response
  const stiffness = omega * omega
  const friction = 2 * damping * omega

  let value = options.from
  let velocity = 0
  let target = options.from
  let frame: number | null = null
  let lastTime = 0

  const finish = (): void => {
    frame = null
    value = target
    velocity = 0
    options.onChange(value)
    options.onRest?.()
  }

  const step = (now: number): void => {
    // Кадр отрабатываем фиксированными подшагами, а не одним большим: при просадке fps
    // (или после фонового таба) единственный крупный шаг явной схемы «взрывает» пружину —
    // она улетает вместо того, чтобы сесть. Подшаг заодно делает движение независимым от
    // частоты экрана: на 60 и 120 Гц оно одинаковое.
    let remaining = Math.min(now - lastTime, MAX_FRAME_MS)
    lastTime = now
    while (remaining > 0) {
      const dt = Math.min(remaining, STEP_MS) / 1000
      remaining -= STEP_MS
      const acceleration = -stiffness * (value - target) - friction * velocity
      velocity += acceleration * dt
      value += velocity * dt
    }

    if (Math.abs(value - target) < REST_DISTANCE && Math.abs(velocity) < REST_VELOCITY) {
      finish()
      return
    }
    options.onChange(value)
    frame = requestAnimationFrame(step)
  }

  const start = (): void => {
    if (frame !== null) return
    lastTime = performance.now()
    frame = requestAnimationFrame(step)
  }

  return {
    get value() {
      return value
    },
    get velocity() {
      return velocity
    },
    get animating() {
      return frame !== null
    },
    set(next: number) {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      value = next
      target = next
      velocity = 0
    },
    to(next: number, nextVelocity?: number) {
      target = next
      if (nextVelocity !== undefined) velocity = nextVelocity
      // Уже на месте и без скорости — анимировать нечего.
      if (Math.abs(value - target) < REST_DISTANCE && Math.abs(velocity) < REST_VELOCITY) {
        finish()
        return
      }
      start()
    },
    stop() {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      velocity = 0
    },
  }
}

/**
 * Куда доедет брошенный объект (§6). Это не школьная формула `v²/(2a)`, а экспоненциальное
 * затухание — то же, по которому тормозит нативная прокрутка, и именно оно даёт ощущение
 * броска: маленькое движение пальцем превращается в большое перемещение.
 *
 * @param velocity скорость в момент отпускания, px/с
 * @param deceleration 0.998 — обычная инерция прокрутки, 0.99 — резче
 */
export function projectMomentum(velocity: number, deceleration = 0.998): number {
  return ((velocity / 1000) * deceleration) / (1 - deceleration)
}

/**
 * Резиновое сопротивление за границей хода (§9). За краем объект следует за пальцем всё
 * хуже и асимптотически замирает: жёсткий стоп читается как «заело», а нарастающее
 * сопротивление — как «реагирую, но дальше ничего нет».
 *
 * @param overshoot насколько палец ушёл за границу
 * @param dimension характерный размер (обычно высота/ширина элемента)
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/**
 * Скорость по недавней истории точек, px/с.
 *
 * Считается по окну последних событий, а не по двум последним точкам: одиночная дельта
 * шумит (палец дрожит, кадры приходят неравномерно), и на ней флик то срабатывает, то нет.
 */
export function velocityFrom(history: { position: number; time: number }[]): number {
  if (history.length < 2) return 0
  const last = history[history.length - 1]!
  // Берём точку не старше 100 мс: за более длинное окно скорость размазывается и
  // резкое движение в самом конце жеста теряется.
  const first = history.find((p) => last.time - p.time <= 100) ?? history[0]!
  const dt = last.time - first.time
  if (dt <= 0) return 0
  return ((last.position - first.position) / dt) * 1000
}

/** Пользователь просил меньше движения — пружину заменяем мгновенным переходом. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
