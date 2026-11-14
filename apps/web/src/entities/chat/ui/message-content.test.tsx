import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageContentMarkdown as MessageContent } from './message-content-markdown'

// Перенос строки в сообщении должен выглядеть так же, как в поле ввода: одна строка —
// один разрыв. У абзаца стоит `whitespace-pre-wrap`, поэтому лишний <br> от markdown
// давал ВТОРОЙ разрыв и пустую строку между строками пузыря.
describe('MessageContent — переносы строк', () => {
  const lines = (html: HTMLElement) => html.querySelector('p')?.textContent ?? ''

  it('жёсткий перенос (обратный слеш) не удваивает разрыв', () => {
    const { container } = render(<MessageContent content={'раз\\\nдва'} />)
    expect(container.querySelector('br')).toBeNull()
    expect(lines(container)).toBe('раз\nдва')
  })

  it('жёсткий перенос (два пробела) не удваивает разрыв', () => {
    const { container } = render(<MessageContent content={'раз  \nдва'} />)
    expect(container.querySelector('br')).toBeNull()
    expect(lines(container)).toBe('раз\nдва')
  })

  it('одиночный перевод строки сохраняется — его рисует pre-wrap', () => {
    const { container } = render(<MessageContent content={'раз\nдва'} />)
    expect(lines(container)).toBe('раз\nдва')
  })

  it('пустая строка остаётся разделением абзацев', () => {
    const { container } = render(<MessageContent content={'раз\n\nдва'} />)
    // Настоящие абзацы отбиваются отступом — в отличие от переноса строки.
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })
})

// Контракт разметки чата (PROJECT.md §3.6): набор Telegram рисуется, прочее — исходным текстом.
describe('MessageContent — контракт разметки чата', () => {
  const html = (content: string) => render(<MessageContent content={content} />).container

  it('жирный, курсив, моно и зачёркнутый рисуются', () => {
    const c = html('**ж** *к* _к2_ `м` ~~з~~')
    expect(c.querySelector('strong')?.textContent).toBe('ж')
    expect(c.querySelectorAll('em')).toHaveLength(2)
    expect(c.querySelector('code')?.textContent).toBe('м')
    expect(c.querySelector('del')?.textContent).toBe('з')
  })

  it('ссылка открывается в новой вкладке', () => {
    const c = html('[сайт](https://example.com)')
    const a = c.querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(a?.getAttribute('target')).toBe('_blank')
  })

  it('цитата, блок кода с языком и списки рисуются', () => {
    const c = html('> цитата\n\n```ts\nconst a = 1\n```\n\n- раз\n- два\n\n1. один')
    expect(c.querySelector('blockquote')?.textContent?.trim()).toBe('цитата')
    expect(c.querySelector('pre code')?.className).toContain('language-ts')
    expect(c.querySelectorAll('ul > li')).toHaveLength(2)
    expect(c.querySelectorAll('ol > li')).toHaveLength(1)
  })

  it('заголовок остаётся текстом с решёткой', () => {
    const c = html('# заголовок')
    expect(c.querySelector('h1')).toBeNull()
    expect(c.textContent).toBe('# заголовок')
  })

  it('заголовок подчёркиванием и линия остаются текстом', () => {
    const c = html('текст\n---\n\n***')
    expect(c.querySelector('h2')).toBeNull()
    expect(c.querySelector('hr')).toBeNull()
    expect(c.textContent).toContain('текст\n---')
  })

  it('таблица остаётся текстом с чертами', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |'
    const c = html(src)
    expect(c.querySelector('table')).toBeNull()
    expect(c.textContent).toBe(src)
  })

  it('картинка остаётся исходным текстом, а не ссылкой', () => {
    const c = html('смотри ![кот](https://example.com/cat.png)')
    expect(c.querySelector('img')).toBeNull()
    expect(c.querySelector('a')).toBeNull()
    expect(c.textContent).toBe('смотри ![кот](https://example.com/cat.png)')
  })

  it('формула и HTML остаются текстом', () => {
    const c = html('$x^2$ и <b>жир</b>')
    expect(c.querySelector('b')).toBeNull()
    expect(c.querySelector('.katex')).toBeNull()
    expect(c.textContent).toBe('$x^2$ и <b>жир</b>')
  })

  it('чекбокс списка остаётся текстом', () => {
    const c = html('- [ ] задача')
    expect(c.querySelector('input')).toBeNull()
    expect(c.querySelector('li')?.textContent).toBe('[ ] задача')
  })
})
