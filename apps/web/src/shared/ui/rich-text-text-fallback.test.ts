import { afterEach, describe, expect, it } from 'vitest'
import { Editor, Node, type AnyExtension, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import { ChatSpoiler, ChatUnderline } from './rich-text-chat-marks'
import {
  MarkdownSafeTable,
  MarkdownTextFallback,
  PasteTablesAsText,
} from './rich-text-text-fallback'

// Сообщение 18.11 ушло в чат как `[table]`: tiptap-markdown при `html: false` пишет узел без
// markdown заглушкой с его именем. Таблица из буфера должна стать текстом (Telegram), а любой
// узел без markdown — писаться своим текстом.
let editor: Editor | null = null

/** Поле чата: набор расширений как в RichTextEditor с `MARKDOWN_ACTIONS_INLINE`. */
function make({
  content = '',
  tableButton = false,
  extra = [],
}: { content?: string | JSONContent; tableButton?: boolean; extra?: AnyExtension[] } = {}) {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ underline: false }),
      TableKit.configure({ table: false }),
      MarkdownSafeTable.configure({ resizable: false }),
      ...(tableButton ? [] : [PasteTablesAsText]),
      ChatUnderline,
      ChatSpoiler,
      ...extra,
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
      MarkdownTextFallback,
    ],
    content,
  })
  return editor
}

const markdownOf = (e: Editor) => e.storage.markdown.getMarkdown()

/** В jsdom нет ClipboardEvent, а `pasteHTML` без события создаёт его сам. */
function paste(e: Editor, html: string): void {
  e.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
}

// Так таблицу кладут в буфер Google Таблицы и страницы без <th>: такую таблицу в GFM не записать.
const SHEET = `<meta charset="utf-8"><google-sheets-html-origin><table><tbody>
  <tr><td>Имя</td><td>Группа</td><td>Балл</td></tr>
  <tr><td> Аня </td><td>ИС-21</td><td><b>95</b></td></tr>
  <tr><td></td><td></td><td></td></tr>
  <tr><td>Борис</td><td><a href="https://x.kz">ИС-22</a></td><td></td></tr>
</tbody></table>`

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('вставка таблицы в поле чата', () => {
  it('таблица из буфера — текст: строка на строку, ячейки через « | »', () => {
    const e = make()
    paste(e, SHEET)
    const md = markdownOf(e)
    expect(md).not.toContain('[table]')
    expect(md).toBe('Имя | Группа | Балл\\\nАня | ИС-21 | **95**\\\nБорис | [ИС-22](https://x.kz)')
    expect(e.getJSON().content?.map((node) => node.type)).toEqual(['paragraph'])
  })

  it('таблица с заголовками — тоже текст, а не разметка GFM', () => {
    const e = make()
    paste(e, '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(markdownOf(e)).toBe('A | B\\\n1 | 2')
  })

  it('текст вокруг таблицы сохраняется, таблица без пустых абзацев вокруг', () => {
    const e = make()
    paste(e, '<p>до</p><table><tr><td>a</td><td>b</td></tr></table><p>после</p>')
    expect(markdownOf(e)).toBe('до\n\na | b\n\nпосле')
  })

  it('таблица ложится в строку курсора, как вставка простого текста', () => {
    const e = make({ content: 'Итоги:' })
    e.commands.focus('end')
    paste(e, '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')
    expect(markdownOf(e)).toBe('Итоги:a | b\\\nc | d')
  })

  it('после отправки и правки текст таблицы разбирается обратно в те же строки', () => {
    const e = make()
    paste(e, SHEET)
    const sent = markdownOf(e)
    editor?.destroy()
    expect(markdownOf(make({ content: sent }))).toBe(sent)
  })

  it('там, где есть кнопка таблицы (статья), вставка остаётся таблицей', () => {
    const e = make({ tableButton: true })
    paste(e, '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(markdownOf(e)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n')
  })
})

describe('запись markdown без заглушек', () => {
  it('таблица без строки заголовков пишется текстом, а не `[table]`', () => {
    const e = make({ tableButton: true })
    paste(e, SHEET)
    expect(markdownOf(e)).toBe(
      'Имя | Группа | Балл\\\nАня | ИС-21 | **95**\\\nБорис | [ИС-22](https://x.kz)',
    )
  })

  it('перенос строки в ячейке GFM — пробелом, а не `[hardBreak]`', () => {
    const e = make({ tableButton: true })
    paste(e, '<table><tr><th>A<br>B</th></tr><tr><td>1</td></tr></table>')
    expect(markdownOf(e)).toBe('| A B |\n| --- |\n| 1 |\n')
  })

  it('неизвестный блок пишется своим текстом с разметкой', () => {
    const Callout = Node.create({
      name: 'callout',
      group: 'block',
      content: 'inline*',
      parseHTML: () => [{ tag: 'aside' }],
      renderHTML: () => ['aside', 0],
    })
    const Panel = Node.create({
      name: 'panel',
      group: 'block',
      content: 'block+',
      parseHTML: () => [{ tag: 'section' }],
      renderHTML: () => ['section', 0],
    })
    const Mention = Node.create({
      name: 'mention',
      group: 'inline',
      inline: true,
      atom: true,
      addAttributes: () => ({ label: { default: '' } }),
      renderText: ({ node }) => `@${node.attrs.label}`,
      parseHTML: () => [{ tag: 'span[data-mention]' }],
      renderHTML: () => ['span', { 'data-mention': '' }],
    })
    const e = make({
      extra: [Callout, Panel, Mention],
      content: {
        type: 'doc',
        content: [
          {
            type: 'callout',
            content: [
              { type: 'text', text: 'Привет, ' },
              { type: 'text', text: 'мир', marks: [{ type: 'bold' }] },
            ],
          },
          {
            type: 'panel',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'пиши ' },
                  { type: 'mention', attrs: { label: 'anya' } },
                ],
              },
            ],
          },
        ],
      },
    })
    const md = markdownOf(e)
    expect(md).not.toMatch(/\[(callout|panel|mention)\]/)
    expect(md).toBe('Привет, **мир**\n\nпиши @anya')
  })

  it('обычная разметка чата пишется как раньше', () => {
    const source = '**a** *b* ++c++ ~~d~~ `e` ||f|| [g](https://x.kz)\n\n- h\n- i\n\n> j'
    expect(markdownOf(make({ content: source }))).toBe(source)
  })
})
