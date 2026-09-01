import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './markdown'

describe('Markdown', () => {
  it('разбирает жирный, курсив, зачёркнутый и код', () => {
    const { container } = render(<Markdown source={'**жирный** *курсив* ~~зачёркнутый~~ `код`'} />)
    expect(container.querySelector('strong')?.textContent).toBe('жирный')
    expect(container.querySelector('em')?.textContent).toBe('курсив')
    expect(container.querySelector('s')?.textContent).toBe('зачёркнутый')
    expect(container.querySelector('code')?.textContent).toBe('код')
  })

  it('собирает соседние строки в один список', () => {
    const { container } = render(<Markdown source={'- раз\n- два\n- три'} />)
    const lists = container.querySelectorAll('ul')
    expect(lists).toHaveLength(1)
    expect(lists[0]?.querySelectorAll('li')).toHaveLength(3)
  })

  it('перенос строки редактора (обратный слеш) не попадает в текст', () => {
    // Поле форматированного текста помечает перенос внутри абзаца обратным слешем —
    // это разметка, а не символ сообщения: строки и так выводятся по отдельности.
    const { container } = render(<Markdown source={'первая\\\nвторая'} />)
    const lines = container.querySelectorAll('p > span')
    expect(lines).toHaveLength(2)
    expect(lines[0]?.textContent).toBe('первая')
    expect(lines[1]?.textContent).toBe('вторая')
  })

  it('нумерованный список и цитата — разные блоки', () => {
    const { container } = render(<Markdown source={'1. раз\n2. два\n> цитата'} />)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(container.querySelector('blockquote')?.textContent).toContain('цитата')
  })

  it('ссылка с http открывается в новой вкладке с noopener и noreferrer', () => {
    render(<Markdown source={'[сайт](https://example.com)'} />)
    const link = screen.getByRole('link', { name: 'сайт' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('javascript: ссылкой не становится', () => {
    // Главная защита разбора: небезопасная схема выводится текстом, а не <a href>.
    const { container } = render(<Markdown source={'[клик](javascript:alert(1))'} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('клик')
  })

  it('html не исполняется, а показывается как текст', () => {
    const { container } = render(<Markdown source={'<img src=x onerror=alert(1)>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('код побеждает жирный внутри себя', () => {
    // Иначе `**` внутри кода съедался бы разбором жирного и ломал пример кода.
    const { container } = render(<Markdown source={'`a ** b`'} />)
    expect(container.querySelector('code')?.textContent).toBe('a ** b')
    expect(container.querySelector('strong')).toBeNull()
  })
})

describe('Markdown — упоминания', () => {
  it('выделяет @username', () => {
    const { container } = render(<Markdown source={'привет @ivanov, смотри'} />)
    const mention = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '@ivanov',
    )
    expect(mention).toBeDefined()
    expect(mention?.className).toContain('text-primary')
  })

  it('почту за упоминание не принимает', () => {
    // «a@b.c» — адрес, а не упоминание: перед @ стоит буква.
    const { container } = render(<Markdown source={'пишите на mail@example.com'} />)
    const mention = Array.from(container.querySelectorAll('span')).find((el) =>
      el.className.includes('text-primary'),
    )
    expect(mention).toBeUndefined()
  })
})
