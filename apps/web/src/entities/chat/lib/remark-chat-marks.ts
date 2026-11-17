import {
  canCloseMarker,
  canOpenMarker,
  markerKind,
  type ChatMarkKind,
} from '../../../shared/lib/chat-markup'

/**
 * Подчёркнутый `++…++` и спойлер `||…||` в разборе пузыря (PROJECT.md §3.6) — поверх
 * дерева, которое уже построил CommonMark + GFM.
 *
 * Почему поверх дерева, а не расширением micromark: остальная разметка остаётся ровно той,
 * что была до 17.11.2026 (старые сообщения выглядят как раньше), а маркеры парятся среди
 * готовых соседей — `||**жирный** спойлер||` даёт спойлер с жирным внутри. Строчный код и
 * блоки кода — узлы со значением, а не с текстом, поэтому внутри кода маркеры не ищутся
 * сами собой. Пара ищется среди детей одного узла (абзаца, пункта, жирного): маркеры по
 * разные стороны границы элемента остаются текстом.
 *
 * Правила маркера — в `shared/lib/chat-markup`, общие с полем ввода и превью.
 */

export interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
  data?: { hName?: string; hProperties?: Record<string, unknown>; chatMark?: true }
}

type Token =
  | { kind: 'node'; node: MdNode }
  | { kind: 'text'; value: string }
  | { kind: 'mark'; char: string; canOpen: boolean; canClose: boolean; pair?: number }

/** Как элемент разметки выглядит для соседнего маркера: перенос — пробел, прочее — знак. */
function edgeChar(node: MdNode | undefined, side: 'first' | 'last'): string | undefined {
  if (!node) return undefined
  if (node.type === 'break') return '\n'
  if (node.type === 'text') return side === 'first' ? node.value?.[0] : node.value?.at(-1)
  return '*'
}

const PUNCT = /[!-/:-@[-`{-~]/

/**
 * Какие знаки текстового узла экранированы в исходнике (`\|` стал `|`). Значение узла и
 * его отрезок исходника идут параллельно: экранирование и сущность (`&amp;`) короче в
 * значении, лишние пробелы начала строки в значение не попадают.
 */
function escapedIndexes(node: MdNode, source: string): Set<number> {
  const out = new Set<number>()
  const value = node.value ?? ''
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return out
  const raw = source.slice(start, end)
  if (raw === value || !raw.includes('\\')) return out
  let i = 0
  let j = 0
  while (i < raw.length && j < value.length) {
    const c = raw[i] as string
    const next = raw[i + 1]
    if (c === '\\' && next !== undefined && PUNCT.test(next) && value[j] === next) {
      out.add(j)
      i += 2
      j += 1
    } else if (c === value[j]) {
      i += 1
      j += 1
    } else if (c === '&') {
      const entity = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]{1,31});/.exec(
        raw.slice(i, i + 40),
      )
      if (!entity) {
        i += 1
        continue
      }
      const code = entity[1] ? Number(entity[1]) : entity[2] ? parseInt(entity[2], 16) : NaN
      i += entity[0].length
      j += Number.isNaN(code) ? 1 : String.fromCodePoint(code).length
    } else {
      // Пробел начала строки и прочее, чего нет в значении.
      i += 1
    }
  }
  return out
}

/** Литеральная автоссылка GFM (`https://…`, `www.…`), а не `[текст](адрес)` и не `<адрес>`. */
function isLiteralLink(node: MdNode, source: string): boolean {
  const start = node.position?.start.offset
  if (node.type !== 'link' || start === undefined) return false
  const first = source[start]
  return first !== '[' && first !== '<' && node.children?.length === 1
}

/**
 * Автоссылка GFM глотает `||` в конце: `||https://x.kz||` — ссылка `https://x.kz||`. Такой
 * хвост — закрывающий маркер, адресу он не принадлежит; `++` отрезается, только если
 * раньше в узле был открывающий `++` (`…/wiki/C++` — честный адрес).
 */
function splitLinkTail(node: MdNode, source: string, plusOpen: boolean): [MdNode, string] | null {
  if (!isLiteralLink(node, source)) return null
  const text = node.children?.[0]
  const url = node.url ?? ''
  const tail = url.slice(-2)
  const kind = markerKind(tail[0])
  if (!kind || tail[1] !== tail[0] || url.at(-3) === tail[0]) return null
  if (kind === 'underline' && !plusOpen) return null
  if (text?.type !== 'text' || !text.value?.endsWith(tail)) return null
  const trimmed: MdNode = {
    ...node,
    url: url.slice(0, -2),
    children: [{ ...text, value: text.value.slice(0, -2), position: undefined }],
    position: undefined,
  }
  return [trimmed, tail]
}

function tokenize(children: MdNode[], source: string): Token[] {
  const tokens: Token[] = []
  let plusOpen = false
  children.forEach((child, index) => {
    if (child.type === 'link') {
      const split = splitLinkTail(child, source, plusOpen)
      if (split) {
        const [link, tail] = split
        tokens.push({ kind: 'node', node: link })
        const next = edgeChar(children[index + 1], 'first')
        tokens.push({
          kind: 'mark',
          char: tail[0] as string,
          canOpen: false,
          canClose: canCloseMarker(link.url?.at(-1), next),
        })
        return
      }
    }
    if (child.type !== 'text' || !child.value) {
      tokens.push({ kind: 'node', node: child })
      return
    }
    const value = child.value
    if (!value.includes('++') && !value.includes('||')) {
      tokens.push({ kind: 'text', value })
      return
    }
    const escaped = escapedIndexes(child, source)
    let from = 0
    for (let k = 0; k < value.length - 1; k++) {
      const c = value[k] as string
      if (
        !markerKind(c) ||
        value[k + 1] !== c ||
        value[k - 1] === c ||
        value[k + 2] === c ||
        escaped.has(k) ||
        escaped.has(k + 1)
      ) {
        continue
      }
      const prev = k > 0 ? value[k - 1] : edgeChar(children[index - 1], 'last')
      const next = k + 2 < value.length ? value[k + 2] : edgeChar(children[index + 1], 'first')
      if (k > from) tokens.push({ kind: 'text', value: value.slice(from, k) })
      const canOpen = canOpenMarker(prev, next)
      if (c === '+' && canOpen) plusOpen = true
      tokens.push({ kind: 'mark', char: c, canOpen, canClose: canCloseMarker(prev, next) })
      from = k + 2
      k += 1
    }
    if (from < value.length) tokens.push({ kind: 'text', value: value.slice(from) })
  })
  return tokens
}

/** Пары маркеров: ближайший закрывающий; незакрытое внутри пары остаётся текстом. */
function pair(tokens: Token[]): void {
  const open: number[] = []
  tokens.forEach((token, index) => {
    if (token.kind !== 'mark') return
    const opener = open.findIndex((at) => (tokens[at] as { char: string }).char === token.char)
    if (token.canClose && opener !== -1) {
      const at = open[opener] as number
      ;(tokens[at] as { pair?: number }).pair = index
      token.pair = at
      open.length = opener
      return
    }
    if (token.canOpen && opener === -1) open.push(index)
  })
}

function wrapper(kind: ChatMarkKind, children: MdNode[]): MdNode {
  return kind === 'spoiler'
    ? {
        type: 'chatSpoiler',
        children,
        data: { hName: 'span', hProperties: { dataSpoiler: '' }, chatMark: true },
      }
    : { type: 'chatUnderline', children, data: { hName: 'u', chatMark: true } }
}

function build(tokens: Token[]): MdNode[] {
  const stack: { kind: ChatMarkKind | null; children: MdNode[] }[] = [{ kind: null, children: [] }]
  const append = (node: MdNode) => {
    const top = stack.at(-1)!.children
    const last = top.at(-1)
    if (node.type === 'text' && last?.type === 'text' && !last.position) {
      last.value = (last.value ?? '') + (node.value ?? '')
    } else {
      top.push(node)
    }
  }
  tokens.forEach((token, index) => {
    if (token.kind === 'node') append(token.node)
    else if (token.kind === 'text') append({ type: 'text', value: token.value })
    else if (token.pair === undefined) append({ type: 'text', value: token.char + token.char })
    else if (token.pair > index) stack.push({ kind: markerKind(token.char), children: [] })
    else {
      const done = stack.pop()!
      append(wrapper(done.kind ?? 'underline', done.children))
    }
  })
  return stack[0]!.children
}

function hasMarkerText(children: MdNode[]): boolean {
  return children.some(
    (child) =>
      (child.type === 'text' && (child.value?.includes('++') || child.value?.includes('||'))) ||
      (child.type === 'link' && /(\+\+|\|\|)$/.test(child.url ?? '')),
  )
}

function walk(node: MdNode, source: string): void {
  if (!node.children) return
  if (!node.data?.chatMark && hasMarkerText(node.children)) {
    const tokens = tokenize(node.children, source)
    pair(tokens)
    node.children = build(tokens)
  }
  node.children.forEach((child) => walk(child, source))
}

/** Применить маркеры чата к дереву разбора `tree` исходника `source`. */
export function applyChatMarks(tree: MdNode, source: string): void {
  walk(tree, source)
}
