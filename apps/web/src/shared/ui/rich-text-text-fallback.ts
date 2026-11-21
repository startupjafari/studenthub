import { Extension, type Editor } from '@tiptap/react'
import { Table } from '@tiptap/extension-table'
import { Fragment, Slice, type Node as PMNode, type NodeSpec, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Узлы, которых нет в markdown чата и постов, — текстом, а не заглушкой.
 *
 * tiptap-markdown пишет узел, для которого у него нет markdown, сырым HTML, а при
 * `html: false` (так настроено поле, см. rich-text-editor) — заглушкой `[имя узла]`, и текст
 * пользователя пропадает. Так 18.11 в чат ушло сообщение `[table]`: таблица, вставленная со
 * страницы или из таблицы Google, разбиралась в узел таблицы без строки заголовков, а такую
 * таблицу в GFM не записать. Здесь три страховки:
 *
 * - `PasteTablesAsText` — вставленная таблица сразу становится текстом, как в Telegram, где
 *   таблиц нет и вставляется text/plain буфера: строка таблицы — строка текста. Только в полях
 *   без кнопки таблицы (чат, пост): их пузырь и лента таблиц не рисуют;
 * - `MarkdownSafeTable` — таблица, которую не записать в GFM (нет строки заголовков,
 *   объединённые ячейки, несколько абзацев в ячейке), пишется теми же строками текста;
 * - `MarkdownTextFallback` — любой другой узел без markdown пишется своим текстом.
 *
 * Ячейки разделены « | », а не табуляцией, как в text/plain у Telegram. Табуляция не доживает до
 * отправки: черновик и правка сообщения заново разбирают markdown в поле, и разбор HTML в
 * ProseMirror схлопывает её в пробел, а однострочное превью в списке чатов — тоже (`\s+`).
 * Ячейки слиплись бы в «Имя Группа Балл». « | » переживает и разбор, и превью, в пузыре читается
 * как граница столбца; спойлер `||` из него не сложится (между чертами всегда пробел), а таблицы
 * GFM в чате выключены при разборе (message-content-markdown).
 */

/** Разделитель ячеек строки таблицы, ставшей текстом. */
export const TABLE_CELL_SEPARATOR = ' | '

/**
 * Текст узла-листа: `renderText` расширения tiptap (`spec.toText`), `leafText` ProseMirror или
 * текст содержимого — так же узел попадает в `editor.getText()`.
 */
function leafText(node: PMNode, parent: PMNode | null = null, index = 0): string {
  const spec = node.type.spec as NodeSpec & {
    toText?: (props: { node: PMNode; pos: number; parent: PMNode | null; index: number }) => string
  }
  return spec.toText?.({ node, pos: 0, parent, index }) ?? spec.leafText?.(node) ?? node.textContent
}

/** Срезать пробелы по краям ряда строчных узлов (у ячеек со страниц их полно). */
function trimInline(nodes: PMNode[]): PMNode[] {
  const list = [...nodes]
  const trimEdge = (at: () => number, pattern: RegExp): void => {
    while (list.length > 0) {
      const index = at()
      const node = list[index] as PMNode
      if (!node.isText) return
      const text = (node.text ?? '').replace(pattern, '')
      if (text) {
        list[index] = node.type.schema.text(text, node.marks)
        return
      }
      list.splice(index, 1)
    }
  }
  trimEdge(() => 0, /^\s+/)
  trimEdge(() => list.length - 1, /\s+$/)
  return list
}

/**
 * Строчное содержимое ячейки с метками (жирный, ссылка): абзацы ячейки — через пробел,
 * перенос строки внутри ячейки — пробелом: перенос разделяет строки таблицы.
 */
function cellInline(cell: PMNode, schema: Schema): PMNode[] {
  const out: PMNode[] = []
  cell.descendants((node) => {
    if (!node.isTextblock) return true
    if (out.length > 0) out.push(schema.text(' '))
    node.forEach((child) => {
      if (child.isText) {
        out.push(child)
        return
      }
      const text = child.type.name === 'hardBreak' ? ' ' : leafText(child, node)
      if (text) out.push(schema.text(text, child.marks))
    })
    return false
  })
  return trimInline(out)
}

/**
 * Таблица — блоки текста: одна строка таблицы — одна строка абзаца (жёсткий перенос, как
 * Shift+Enter в чате), ячейки через `TABLE_CELL_SEPARATOR`. Пустые строки и пустые ячейки в
 * конце строки отбрасываются. Без узла переноса в схеме — абзац на строку.
 */
export function tableToTextBlocks(table: PMNode, schema: Schema): PMNode[] {
  const separator = schema.text(TABLE_CELL_SEPARATOR)
  const rows: PMNode[][] = []
  table.forEach((row) => {
    const cells: PMNode[][] = []
    row.forEach((cell) => void cells.push(cellInline(cell, schema)))
    while (cells.length > 0 && (cells[cells.length - 1] as PMNode[]).length === 0) cells.pop()
    if (cells.length === 0) return
    rows.push(cells.flatMap((cell, i) => (i === 0 ? cell : [separator, ...cell])))
  })
  const paragraph = schema.nodes.paragraph
  if (!paragraph || rows.length === 0) return []
  const lineBreak = schema.nodes.hardBreak
  if (!lineBreak) return rows.map((row) => paragraph.create(null, row))
  const line = rows.flatMap((row, i) => (i === 0 ? row : [lineBreak.create(), ...row]))
  return [paragraph.create(null, line)]
}

const isTable = (node: PMNode): boolean => node.type.spec.tableRole === 'table'

/** Заменить таблицы во фрагменте (на любой глубине) текстом; `made` — получившиеся блоки. */
function replaceTables(fragment: Fragment, schema: Schema, made: Set<PMNode>): Fragment {
  let changed = false
  const children: PMNode[] = []
  fragment.forEach((child) => {
    if (isTable(child)) {
      changed = true
      for (const block of tableToTextBlocks(child, schema)) {
        made.add(block)
        children.push(block)
      }
      return
    }
    if (child.isTextblock || child.childCount === 0) {
      children.push(child)
      return
    }
    const content = replaceTables(child.content, schema, made)
    if (content !== child.content) changed = true
    children.push(content === child.content ? child : child.copy(content))
  })
  return changed ? Fragment.fromArray(children) : fragment
}

/** На какую глубину можно открыть край фрагмента: до текстового блока включительно. */
function maxOpenDepth(node: PMNode | null, side: 'start' | 'end'): number {
  if (!node || node.isLeaf || node.isInline) return 0
  if (node.isTextblock) return 1
  return 1 + maxOpenDepth(side === 'start' ? node.firstChild : node.lastChild, side)
}

/**
 * Вставленный фрагмент без таблиц. Таблица на краю вставки становится открытым абзацем:
 * её текст ложится в строку, где стоит курсор, как вставка простого текста, — без пустого
 * абзаца перед собой и без разрыва строки, в которой стоял курсор.
 */
export function pastedTablesAsText(slice: Slice, schema: Schema): Slice {
  const made = new Set<PMNode>()
  const content = replaceTables(slice.content, schema, made)
  if (content === slice.content) return slice
  const first = content.firstChild
  const last = content.lastChild
  const openStart =
    first && made.has(first) ? 1 : Math.min(slice.openStart, maxOpenDepth(first, 'start'))
  const openEnd = last && made.has(last) ? 1 : Math.min(slice.openEnd, maxOpenDepth(last, 'end'))
  return new Slice(content, openStart, openEnd)
}

/** Вставка таблицы — текстом (Telegram). Ставится в поля без кнопки таблицы. */
export const PasteTablesAsText = Extension.create({
  name: 'pasteTablesAsText',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pasteTablesAsText'),
        props: { transformPasted: (slice, view) => pastedTablesAsText(slice, view.state.schema) },
      }),
    ]
  },
})

/**
 * Состояние записи markdown (prosemirror-markdown) — то немногое, что нужно здесь. Сам пакет
 * в зависимостях web не числится: он приходит внутри tiptap-markdown.
 */
interface MarkdownState {
  write: (content: string) => void
  text: (text: string, escape?: boolean) => void
  ensureNewLine: () => void
  closeBlock: (node: PMNode) => void
  render: (node: PMNode, parent: PMNode, index: number) => void
  renderInline: (parent: PMNode) => void
  renderContent: (parent: PMNode) => void
  inTable?: boolean
}

type NodeSerializer = (state: MarkdownState, node: PMNode, parent: PMNode, index: number) => void

const hasSpan = (cell: PMNode): boolean => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1

/** Ложится ли таблица в GFM — то же условие, что у tiptap-markdown. */
function isGfmTable(table: PMNode): boolean {
  let gfm = true
  table.forEach((row, _offset, i) => {
    row.forEach((cell) => {
      const header = cell.type.name === 'tableHeader'
      if ((i === 0) !== header || hasSpan(cell) || cell.childCount > 1) gfm = false
    })
  })
  return gfm
}

/** Абзац ячейки GFM без переносов строки: в GFM строка таблицы — одна строка markdown. */
function withoutLineBreaks(block: PMNode): PMNode {
  let changed = false
  const children: PMNode[] = []
  block.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      changed = true
      children.push(block.type.schema.text(' ', child.marks))
      return
    }
    children.push(child)
  })
  return changed ? block.copy(Fragment.fromArray(children)) : block
}

/**
 * Таблица: в GFM, если ложится (статья), иначе — строками текста вместо заглушки `[table]`.
 * Запись GFM повторяет tiptap-markdown — своя спецификация узла заменяет его целиком; перенос
 * строки в ячейке пишется пробелом (у tiptap-markdown он уходил заглушкой `[hardBreak]`).
 */
const serializeTable: NodeSerializer = (state, node, parent, index) => {
  if (!isGfmTable(node)) {
    tableToTextBlocks(node, node.type.schema).forEach((block) => state.render(block, parent, index))
    return
  }
  state.inTable = true
  node.forEach((row, _offset, i) => {
    state.write('| ')
    row.forEach((cell, _cellOffset, j) => {
      if (j) state.write(' | ')
      const content = cell.firstChild
      if (content && content.textContent.trim()) state.renderInline(withoutLineBreaks(content))
    })
    state.write(' |')
    state.ensureNewLine()
    if (i === 0) {
      state.write(`| ${Array.from({ length: row.childCount }, () => '---').join(' | ')} |`)
      state.ensureNewLine()
    }
  })
  state.closeBlock(node)
  state.inTable = false
}

export const MarkdownSafeTable = Table.extend({
  addStorage() {
    return { ...this.parent?.(), markdown: { serialize: serializeTable } }
  },
})

/** Узел без markdown — его содержимым: текст и разметка внутри сохраняются. */
const serializeAsText: NodeSerializer = (state, node, parent, index) => {
  if (node.inlineContent) {
    state.renderInline(node)
  } else if (node.isLeaf) {
    const text = leafText(node, parent, index)
    if (text) state.text(text)
  } else {
    state.renderContent(node)
  }
  if (node.isBlock) state.closeBlock(node)
}

/** Внутренности сериализатора tiptap-markdown, которые подменяет `MarkdownTextFallback`. */
interface TiptapMarkdownSerializer {
  nodes: Record<string, NodeSerializer>
  serializeNode: (extension: { name: string; options?: unknown }) => NodeSerializer | undefined
}

function installTextFallback(editor: Editor): void {
  const storage = editor.storage.markdown as unknown as { serializer?: TiptapMarkdownSerializer }
  const serializer = storage?.serializer
  if (!serializer) return
  const getNodes = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(serializer), 'nodes')?.get
  if (!getNodes) return
  // Есть ли у узла markdown: своя спецификация в расширении или встроенная у tiptap-markdown
  // (её `serializeNode` находит по одному имени). Остальным он подставляет заглушку.
  const own = new Set(
    editor.extensionManager.extensions
      .filter((extension) => {
        const markdown = (extension.storage as { markdown?: { serialize?: unknown } } | undefined)
          ?.markdown
        return extension.type === 'node' && Boolean(markdown?.serialize)
      })
      .map((extension) => extension.name),
  )
  const plain = Object.keys(editor.schema.nodes).filter(
    (name) => !own.has(name) && !serializer.serializeNode({ name, options: {} }),
  )
  Object.defineProperty(serializer, 'nodes', {
    configurable: true,
    get() {
      const nodes = getNodes.call(serializer) as Record<string, NodeSerializer>
      for (const name of plain) nodes[name] = serializeAsText
      return nodes
    },
  })
}

/**
 * Узлы без markdown пишутся текстом. Приоритет ниже, чем у `Markdown` (50): сериализатор
 * он создаёт в своём `onBeforeCreate`, а они вызываются по убыванию приоритета.
 */
export const MarkdownTextFallback = Extension.create({
  name: 'markdownTextFallback',
  priority: 40,
  onBeforeCreate() {
    installTextFallback(this.editor)
  },
})
