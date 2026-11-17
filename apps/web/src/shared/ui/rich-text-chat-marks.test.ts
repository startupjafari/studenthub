import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { ChatSpoiler, ChatUnderline } from './rich-text-chat-marks'

// Поле ввода чата: ++подчёркнутый++ и ||спойлер|| разбираются и пишутся обратно теми же
// маркерами (PROJECT.md §3.6) — черновик и правка не теряют разметку.
let editor: Editor | null = null

function make(content: string, chatMarks = true): Editor {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ underline: false }),
      ...(chatMarks ? [ChatUnderline, ChatSpoiler] : []),
      Markdown.configure({ html: false }),
    ],
    content,
  })
  return editor
}

const markdownOf = (e: Editor) => e.storage.markdown.getMarkdown()

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('поле чата — подчёркнутый и спойлер', () => {
  it('разбирает маркеры в метки', () => {
    const e = make('a ++b++ и ||c|| d')
    expect(e.getHTML()).toContain('<u>b</u>')
    expect(e.getHTML()).toMatch(/<span[^>]*data-spoiler[^>]*>c<\/span>/)
  })

  it('пишет метки обратно теми же маркерами', () => {
    const source = 'a ++b++ и ||c **d**|| e'
    expect(markdownOf(make(source))).toBe(source)
  })

  it('маркер посреди слова без пробела перед ним не разбирается', () => {
    const e = make('a||b||c')
    expect(e.getHTML()).not.toContain('data-spoiler')
    expect(markdownOf(e)).toBe('a||b||c')
  })

  it('кнопка оборачивает выделение и выносит пробелы за маркер', () => {
    const e = make('раз два')
    // Выделение «два » вместе с пробелом перед ним.
    e.chain().setTextSelection({ from: 4, to: 8 }).toggleMark('spoiler').run()
    expect(markdownOf(e)).toBe('раз ||два||')
    e.chain().selectAll().toggleMark('underline').run()
    expect(markdownOf(e)).toContain('++')
  })

  it('без меток чата (пост) маркеры остаются текстом', () => {
    const e = make('||a|| ++b++', false)
    expect(e.getHTML()).not.toContain('data-spoiler')
    expect(e.getHTML()).not.toContain('<u>')
  })
})
