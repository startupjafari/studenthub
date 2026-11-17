import { Mark, markInputRule } from '@tiptap/react'
import { findClosingMarker, isOpeningMarker, markerKind } from '../lib/chat-markup'

/**
 * Подчёркнутый `++…++` и спойлер `||…||` в поле ввода чата (PROJECT.md §3.6).
 *
 * Своими метками, а не `@tiptap/extension-underline`: от пакета нужно было бы только имя и
 * `<u>`, а markdown у него — HTML, которого в контракте нет. Разбор markdown в поле идёт
 * через markdown-it (tiptap-markdown): маркеры добавляются туда строчным правилом с теми
 * же правилами пары, что у пузыря (`shared/lib/chat-markup`), — иначе черновик и правка
 * размечались бы не так, как отправленное сообщение.
 *
 * Горячие клавиши — как в Telegram Web: Ctrl/Cmd+U — подчёркнутый, Ctrl/Cmd+Shift+P —
 * спойлер. Набранные `++текст++` и `||текст||` превращаются в разметку сразу, как `**`.
 */

/** Кусок состояния строчного разбора markdown-it, который нужен правилам. */
interface InlineState {
  src: string
  pos: number
  posMax: number
  pending: string
  push: (type: string, tag: string, nesting: number) => { attrs: [string, string][] | null }
  md: { inline: { tokenize: (state: InlineState) => void } }
}

type InlineRule = (state: InlineState, silent: boolean) => boolean

interface MarkdownIt {
  inline: {
    ruler: {
      before: (name: string, rule: string, fn: InlineRule) => void
      at: (name: string, fn: InlineRule) => void
    }
  }
}

const TAGS = {
  underline: { tag: 'u', attrs: null },
  spoiler: { tag: 'span', attrs: [['data-spoiler', '']] as [string, string][] },
} as const

/** Пара маркеров с позиции разбора: `<u>…</u>` или `<span data-spoiler>…</span>`. */
const chatMarksRule: InlineRule = (state, silent) => {
  const at = state.pos
  const kind = markerKind(state.src[at])
  if (!kind || !isOpeningMarker(state.src, at, 0, state.posMax)) return false
  const close = findClosingMarker(state.src, at, state.posMax)
  if (close === -1) return false
  if (silent) return true
  const { tag, attrs } = TAGS[kind]
  state.push(`${kind}_open`, tag, 1).attrs = attrs ? [...attrs] : null
  const max = state.posMax
  state.pos = at + 2
  state.posMax = close
  state.md.inline.tokenize(state)
  state.pos = close + 2
  state.posMax = max
  state.push(`${kind}_close`, tag, -1)
  return true
}

/**
 * Правило простого текста markdown-it, которое останавливается и на `|`. Встроенное
 * проглатывает `|` вместе с текстом (для него это не служебный знак), и правило маркеров
 * не увидело бы `||` посреди строки. Список знаков — тот же, что у встроенного, плюс `|`.
 */
const TERMINATORS = new Set('\n!#$%&*+-:<=>@[\\]^_`{}~|')

const textRule: InlineRule = (state, silent) => {
  let pos = state.pos
  while (pos < state.posMax && !TERMINATORS.has(state.src[pos] as string)) pos++
  if (pos === state.pos) return false
  if (!silent) state.pending += state.src.slice(state.pos, pos)
  state.pos = pos
  return true
}

/** Разборщик поля разбирает markdown при каждой вставке значения: правила — один раз. */
const extended = new WeakSet<object>()

function extendMarkdownIt(md: MarkdownIt): void {
  if (extended.has(md)) return
  extended.add(md)
  md.inline.ruler.at('text', textRule)
  md.inline.ruler.before('text', 'chat_marks', chatMarksRule)
}

/** Сериализация в markdown: пробелы на краях выносятся за маркер, иначе пара не сложится. */
function markdownStorage(marker: string) {
  return {
    markdown: {
      serialize: { open: marker, close: marker, expelEnclosingWhitespace: true },
      parse: { setup: extendMarkdownIt },
    },
  }
}

/**
 * Приоритет выше стандартных меток: метка раньше в схеме — внешняя при записи markdown,
 * и выделение с жирным внутри пишется `||c **d**||`, а не `||c|| **||d||**`.
 */
const OUTER = 1000

export const ChatUnderline = Mark.create({
  name: 'underline',
  priority: OUTER,
  parseHTML: () => [{ tag: 'u' }],
  renderHTML: ({ HTMLAttributes }) => ['u', HTMLAttributes, 0],
  addStorage: () => markdownStorage('++'),
  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor.commands.toggleMark(this.name),
      'Mod-U': () => this.editor.commands.toggleMark(this.name),
    }
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(\+\+(?!\s)([^+\n]+?)(?<!\s)\+\+)$/, type: this.type })]
  },
})

export const ChatSpoiler = Mark.create({
  name: 'spoiler',
  priority: OUTER + 1,
  parseHTML: () => [{ tag: 'span[data-spoiler]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', { ...HTMLAttributes, 'data-spoiler': '' }, 0],
  addStorage: () => markdownStorage('||'),
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-p': () => this.editor.commands.toggleMark(this.name),
      'Mod-Shift-P': () => this.editor.commands.toggleMark(this.name),
    }
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(\|\|(?!\s)([^|\n]+?)(?<!\s)\|\|)$/, type: this.type })]
  },
})
