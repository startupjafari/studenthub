import { act, fireEvent, render as baseRender } from '@testing-library/react'
import type { ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import ru from '../../../../messages/ru.json'
import { MessageContentMarkdown as MessageContent } from './message-content-markdown'

// Спойлер подписан для скринридера — нужен словарь.
const render = (ui: ReactElement) =>
  baseRender(
    <NextIntlClientProvider locale="ru" messages={ru}>
      {ui}
    </NextIntlClientProvider>,
  )

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

// Маркеры чата сверх CommonMark (PROJECT.md §3.6): подчёркнутый ++…++ и спойлер ||…||.
describe('MessageContent — подчёркнутый и спойлер', () => {
  const html = (content: string) => render(<MessageContent content={content} />).container
  const spoilers = (c: HTMLElement) => c.querySelectorAll('.message-spoiler')

  it('подчёркнутый рисуется тегом u', () => {
    const c = html('это ++важно++ знать')
    expect(c.querySelector('u')?.textContent).toBe('важно')
    expect(c.textContent).toBe('это важно знать')
  })

  it('спойлер скрыт до щелчка, щелчок открывает все спойлеры сообщения', () => {
    const c = html('ответ ||42|| и ||43||')
    expect(spoilers(c)).toHaveLength(2)
    expect(c.querySelectorAll('[data-hidden]')).toHaveLength(2)
    // Скринридер не читает текст до открытия: внутренность скрыта, у кнопки — подпись.
    const first = c.querySelector('[data-hidden]') as HTMLElement
    expect(first.getAttribute('role')).toBe('button')
    expect(first.querySelector('[aria-hidden]')?.textContent).toBe('42')
    fireEvent.click(first)
    expect(c.querySelectorAll('[data-hidden]')).toHaveLength(0)
    expect(c.textContent).toBe('ответ 42 и 43')
  })

  it('спойлер открывается с клавиатуры', () => {
    const c = html('||тайна||')
    fireEvent.keyDown(c.querySelector('[data-hidden]') as HTMLElement, { key: 'Enter' })
    expect(c.querySelector('[data-hidden]')).toBeNull()
  })

  it('разметка внутри спойлера и подчёркнутого', () => {
    const c = html('||**жир** и ++под++||')
    const spoiler = spoilers(c)[0] as HTMLElement
    expect(spoiler.querySelector('strong')?.textContent).toBe('жир')
    expect(spoiler.querySelector('u')?.textContent).toBe('под')
  })

  it('ссылка внутри спойлера не открывается, пока спойлер скрыт', () => {
    const c = html('||[сайт](https://example.com)||')
    const link = c.querySelector('a') as HTMLAnchorElement
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      link.dispatchEvent(click)
    })
    expect(click.defaultPrevented).toBe(true)
    expect(c.querySelector('[data-hidden]')).toBeNull()
  })

  it('автоссылка не глотает закрывающий маркер', () => {
    const c = html('см. ||смотри https://example.com|| ок')
    const a = c.querySelector('.message-spoiler a')
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(c.textContent).toBe('см. смотри https://example.com ок')
  })

  it('адрес с ++ на конце остаётся адресом', () => {
    const c = html('https://en.wikipedia.org/wiki/C++')
    expect(c.querySelector('a')?.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/C++')
    expect(c.querySelector('u')).toBeNull()
  })

  it('код, выражения и экранирование остаются текстом', () => {
    for (const src of ['i++; j++', 'C++ и C++', 'a || b || c', 'a||b||c']) {
      const c = html(src)
      expect(c.querySelector('u, .message-spoiler')).toBeNull()
      expect(c.textContent).toBe(src)
    }
    const escaped = html('\\|\\|не спойлер\\|\\|')
    expect(escaped.querySelector('.message-spoiler')).toBeNull()
    expect(escaped.textContent).toBe('||не спойлер||')
  })

  it('внутри кода маркеры не разбираются', () => {
    const c = html('`||код||`\n\n```\n++блок++\n```')
    expect(c.querySelector('.message-spoiler, u')).toBeNull()
    expect(c.querySelector('code')?.textContent).toBe('||код||')
  })

  it('пара в пределах элемента: через границу жирного — текст', () => {
    const c = html('||a **b|| c**')
    expect(c.querySelector('.message-spoiler')).toBeNull()
  })

  it('старая разметка не изменилась: __жирный__ — жирный', () => {
    const c = html('__жирный__')
    expect(c.querySelector('strong')?.textContent).toBe('жирный')
    expect(c.querySelector('u')).toBeNull()
  })

  it('спойлер в цитате и пункте списка', () => {
    const c = html('> ||в цитате||\n\n- ||в пункте||')
    expect(c.querySelectorAll('blockquote .message-spoiler')).toHaveLength(1)
    expect(c.querySelectorAll('li .message-spoiler')).toHaveLength(1)
  })
})
