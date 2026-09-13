import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageContent } from './message-content'

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
