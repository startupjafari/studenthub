/**
 * Парные маркеры разметки сообщения чата сверх CommonMark (PROJECT.md §3.6): подчёркнутый
 * `++текст++` и спойлер `||текст||`. Одни правила на разбор пузыря (remark), поля ввода
 * (markdown-it внутри tiptap-markdown) и однострочного превью — здесь, иначе одно и то же
 * сообщение размечалось бы по-разному в пузыре, в поле правки и в списке чатов.
 *
 * Правила (те же у iOS и Android):
 * - маркер — ровно два знака, не часть серии `+++` / `|||`;
 * - открывающий: перед ним начало или не буква и не цифра, после — не пробел;
 * - закрывающий: перед ним не пробел, после — конец или не буква и не цифра;
 * - пара — ближайший подходящий закрывающий в пределах абзаца, внутри кода не ищется;
 * - `\|` и `\+` — экранирование.
 * Границы отсекают код и выражения, где такие знаки встречались до 17.11.2026:
 * `i++; j++`, `C++ и C++`, `a || b`, `a||b||c` остаются текстом.
 */

export type ChatMarkKind = 'underline' | 'spoiler'

export const CHAT_MARKERS: Readonly<Record<string, ChatMarkKind>> = {
  '+': 'underline',
  '|': 'spoiler',
}

const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/u

/** Знак маркера (`+` или `|`) — или `null`. */
export function markerKind(char: string | undefined): ChatMarkKind | null {
  return char === undefined ? null : (CHAT_MARKERS[char] ?? null)
}

/**
 * Может ли маркер открыть пару. `prev`/`next` — соседние знаки, `undefined` — край абзаца.
 * Сосед-элемент разметки (жирный, ссылка) передаётся как знак препинания, например `*`.
 */
export function canOpenMarker(prev: string | undefined, next: string | undefined): boolean {
  return (prev === undefined || !WORD.test(prev)) && next !== undefined && !SPACE.test(next)
}

/** Может ли маркер закрыть пару (см. `canOpenMarker`). */
export function canCloseMarker(prev: string | undefined, next: string | undefined): boolean {
  return prev !== undefined && !SPACE.test(prev) && (next === undefined || !WORD.test(next))
}

/** Сколько знаков `\` подряд стоит перед `at`: нечётное число — знак экранирован. */
function isEscaped(text: string, at: number): boolean {
  let slashes = 0
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) slashes++
  return slashes % 2 === 1
}

/** Длина серии одинаковых знаков с позиции `at`. */
function runLength(text: string, at: number): number {
  let end = at
  while (text[end] === text[at]) end++
  return end - at
}

/**
 * Конец строчного кода, начатого серией обратных кавычек в `at`, — позиция после
 * закрывающей серии той же длины; `-1`, если кода нет (незакрытая серия — просто текст).
 */
function codeSpanEnd(text: string, at: number, limit: number): number {
  const fence = runLength(text, at)
  let i = at + fence
  while (i < limit) {
    if (text[i] === '`') {
      const run = runLength(text, i)
      if (run === fence) return i + run
      i += run
    } else {
      i++
    }
  }
  return -1
}

/** Маркер из ровно двух знаков в `at` — не часть более длинной серии и не экранирован. */
function isPairMarker(text: string, at: number): boolean {
  const char = text[at]
  return (
    markerKind(char) !== null &&
    text[at + 1] === char &&
    text[at - 1] !== char &&
    text[at + 2] !== char &&
    !isEscaped(text, at)
  )
}

/**
 * Закрывающий маркер для открывающего в `open` — позиция его первого знака, или `-1`.
 * Ищется до `limit`, не дальше пустой строки (конец абзаца), мимо строчного кода и
 * экранированных знаков.
 */
export function findClosingMarker(text: string, open: number, limit = text.length): number {
  const char = text[open]
  let i = open + 2
  while (i < limit) {
    const c = text[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '\n' && /^\n[ \t]*\n/.test(text.slice(i, i + 64))) return -1
    if (c === '`') {
      const end = codeSpanEnd(text, i, limit)
      i = end === -1 ? i + runLength(text, i) : end
      continue
    }
    if (c === char && isPairMarker(text, i) && i > open + 2) {
      if (canCloseMarker(text[i - 1], i + 2 < limit ? text[i + 2] : undefined)) return i
    }
    i++
  }
  return -1
}

/** Открывающий маркер в `at` (с проверкой соседей) — для разборщиков, идущих по строке. */
export function isOpeningMarker(text: string, at: number, start = 0, limit = text.length): boolean {
  return (
    isPairMarker(text, at) &&
    canOpenMarker(at > start ? text[at - 1] : undefined, at + 2 < limit ? text[at + 2] : undefined)
  )
}

/**
 * Пройти строку и заменить каждую пару маркеров тем, что вернёт `replace` (внутренности —
 * уже обработанные тем же проходом). Строчный код и экранирование остаются как есть: их
 * снимает вызывающий. Нужен однострочным превью, где разметку не рисуют, а снимают.
 */
export function replaceChatMarks(
  text: string,
  replace: (kind: ChatMarkKind, inner: string) => string,
): string {
  if (!text.includes('++') && !text.includes('||')) return text
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (c === '\\') {
      out += text.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === '`') {
      const end = codeSpanEnd(text, i, text.length)
      const next = end === -1 ? i + runLength(text, i) : end
      out += text.slice(i, next)
      i = next
      continue
    }
    if (isOpeningMarker(text, i)) {
      const close = findClosingMarker(text, i)
      const kind = markerKind(c)
      if (close !== -1 && kind) {
        out += replace(kind, replaceChatMarks(text.slice(i + 2, close), replace))
        i = close + 2
        continue
      }
    }
    out += c
    i++
  }
  return out
}

/** Сколько знаков Брайля самое большее ставится вместо текста спойлера. */
const SPOILER_PLACEHOLDER_MAX = 12

/**
 * Спойлер в однострочном превью: знаки Брайля `⠿` той же длины (не больше 12), как в
 * Telegram, — сам текст в превью не попадает.
 */
export function spoilerPlaceholder(visible: string): string {
  const length = Math.min(Math.max([...visible.trim()].length, 1), SPOILER_PLACEHOLDER_MAX)
  return '⠿'.repeat(length)
}
