/**
 * Компоновка интерактивного слоя сторис: опрос, ссылка, «Упомянуты · N».
 *
 * Здесь только решения — без отрисовки и без DOM: что показать сразу, что свернуть, в каком
 * виде разложить варианты опроса и сколько их влезает. Один и тот же расчёт работает в
 * просмотрщике и в превью редактора, поэтому автор видит ровно то, что увидит зритель.
 *
 * Слой стоит в потоке нижней зоны кадра, над системным рядом (реакции, ответ, просмотры):
 * пересечений не решают z-index'ом — их нет по построению. Ограничение одно — высота.
 */

/** Компактный опрос занимает не больше этой доли высоты кадра. */
export const POLL_HEIGHT_SHARE = 0.3
/** Кадр ниже этой высоты (px) — «маленький экран»: опрос с соседями сворачивается во вкладки. */
export const SMALL_FRAME_PX = 560
/** Вариант «короткий», если помещается в полстроки кадра: тогда варианты встают рядом. */
export const SHORT_OPTION_CHARS = 16

// Геометрия карточки опроса — те же числа, что в разметке (StoryPollCard).
const CARD_PAD_PX = 12 * 2
const QUESTION_LINE_PX = 20
const QUESTION_MAX_LINES = 2
const QUESTION_GAP_PX = 8
const OPTION_PX = 40
const OPTION_GAP_PX = 6
const MORE_PX = 36
// Средняя ширина знака в пикселях для оценки переноса вопроса (14px, sans).
const CHAR_PX = 7.5

export type PollShape = 'row' | 'grid' | 'list'

/**
 * Раскладка вариантов: два коротких — рядом, три-четыре коротких — сеткой 2×2, иначе
 * (хоть один длинный) — столбиком, где длинный текст не рвётся посреди слова.
 */
export function pollShape(options: readonly string[]): PollShape {
  const short = options.every((o) => o.trim().length <= SHORT_OPTION_CHARS)
  if (!short) return 'list'
  if (options.length === 2) return 'row'
  if (options.length <= 4) return 'grid'
  return 'list'
}

/** Сколько строк займёт вопрос при ширине карточки (не больше двух — дальше многоточие). */
export function questionLines(question: string, widthPx: number): number {
  const perLine = Math.max(8, Math.floor((widthPx - CARD_PAD_PX) / CHAR_PX))
  return Math.min(QUESTION_MAX_LINES, Math.max(1, Math.ceil(question.length / perLine)))
}

function rowsHeight(rows: number): number {
  return rows <= 0 ? 0 : rows * OPTION_PX + (rows - 1) * OPTION_GAP_PX
}

/**
 * Сколько вариантов показать в компактном опросе, чтобы карточка уложилась в 30% кадра.
 * Не влезают все — остаётся место под кнопку «Все варианты (N)». 0 — места нет даже под
 * один вариант: показываем вопрос и кнопку, сами варианты — в раскрытой панели.
 */
export function pollVisibleCount({
  options,
  question,
  frameWidth,
  frameHeight,
}: {
  options: readonly string[]
  question: string
  frameWidth: number
  frameHeight: number
}): number {
  const n = options.length
  if (n === 0) return 0
  const budget = frameHeight * POLL_HEIGHT_SHARE
  const head =
    CARD_PAD_PX + questionLines(question, frameWidth) * QUESTION_LINE_PX + QUESTION_GAP_PX
  const shape = pollShape(options)
  const perRow = shape === 'list' ? 1 : 2
  const rowsFor = (count: number): number => (shape === 'row' ? 1 : Math.ceil(count / perRow))
  if (head + rowsHeight(rowsFor(n)) <= budget) return n
  // Не влезли все: под кнопку «Все варианты» — своя строка.
  const room = budget - head - MORE_PX - OPTION_GAP_PX
  let visible = 0
  for (let k = 1; k < n; k++) {
    if (rowsHeight(rowsFor(k)) <= room) visible = k
  }
  // Сетку не обрываем посередине ряда: половина ряда выглядит как ошибка вёрстки.
  return shape === 'list' ? visible : visible - (visible % 2)
}

export type InteractiveKind = 'poll' | 'link' | 'people'

export interface InteractivePlan {
  /** Что есть у кадра, в порядке приоритета: опрос — главный интерактив. */
  kinds: InteractiveKind[]
  /**
   * `stack` — опрос карточкой и под ним ряд компактных стикеров (ссылка, люди).
   * `tabs` — тесно: ряд вкладок «Опрос · Ссылка · Люди», раскрыт один блок за раз.
   */
  mode: 'stack' | 'tabs'
}

/**
 * Что и как показать. Отметка одного человека — это стикер, который автор поставил на
 * кадр, его не дублируем; «Упомянуты · N» появляется с двух отметок — список удобнее, чем
 * охота за плашками по кадру. Три вида сразу или опрос с соседом на низком кадре — вкладки:
 * три панели одна над другой закрыли бы кадр.
 */
export function planInteractive({
  hasPoll,
  hasLink,
  mentionCount,
  frameHeight,
}: {
  hasPoll: boolean
  hasLink: boolean
  mentionCount: number
  frameHeight: number
}): InteractivePlan {
  const kinds: InteractiveKind[] = []
  if (hasPoll) kinds.push('poll')
  if (hasLink) kinds.push('link')
  if (mentionCount >= 2) kinds.push('people')
  const crowded =
    kinds.length >= 3 || (hasPoll && kinds.length >= 2 && frameHeight < SMALL_FRAME_PX)
  return { kinds, mode: crowded ? 'tabs' : 'stack' }
}

/**
 * Проценты голосов, которые в сумме дают ровно 100 (метод наибольших остатков): при
 * простом округлении три равных варианта показывали 33 + 33 + 33, а 1/3 и 2/3 — 33 + 67 или
 * 34 + 67 в зависимости от погрешности. Без голосов — нули.
 */
export function pollPercents(votes: readonly number[]): number[] {
  const total = votes.reduce((sum, v) => sum + v, 0)
  if (total <= 0) return votes.map(() => 0)
  const exact = votes.map((v) => (v / total) * 100)
  const floors = exact.map(Math.floor)
  let left = 100 - floors.reduce((sum, v) => sum + v, 0)
  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  const out = [...floors]
  for (const { i } of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }
  return out
}

/**
 * Ссылка, которую можно открыть: только http и https. Сервер принимает лишь их, но старые
 * сторис и чужие клиенты — не повод открывать `javascript:` по клику. Иначе — null, и
 * стикера нет вовсе.
 */
export function safeStoryLink(url: string | null | undefined): URL | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}
