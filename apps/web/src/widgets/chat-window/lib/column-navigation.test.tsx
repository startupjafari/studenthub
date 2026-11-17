import { describe, expect, it } from 'vitest'
import { interceptableHref } from './column-navigation'

// Переход из правой колонки (§55): перехватываются только обычные внутренние ссылки —
// новую вкладку, внешний сайт и скачивание браузер делает сам.

function clickOn(
  attrs: Record<string, string>,
  init: Partial<Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {},
) {
  const a = document.createElement('a')
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
  const span = document.createElement('span')
  a.appendChild(span)
  document.body.appendChild(a)
  const event = {
    defaultPrevented: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
    target: span,
  }
  return event as unknown as React.MouseEvent
}

describe('interceptableHref', () => {
  it('внутренняя ссылка на другую страницу — перехватывается', () => {
    expect(interceptableHref(clickOn({ href: '/profile/u1' }))).toBe('/profile/u1')
  })

  it('внешняя, новая вкладка, скачивание и клик с модификатором — нет', () => {
    expect(interceptableHref(clickOn({ href: 'https://example.com/x' }))).toBeNull()
    expect(interceptableHref(clickOn({ href: '/profile/u1', target: '_blank' }))).toBeNull()
    expect(interceptableHref(clickOn({ href: '/f.pdf', download: '' }))).toBeNull()
    expect(interceptableHref(clickOn({ href: '/profile/u1' }, { ctrlKey: true }))).toBeNull()
    expect(interceptableHref(clickOn({ href: '/profile/u1' }, { button: 1 }))).toBeNull()
  })

  it('тот же адрес — колонку закрывать незачем', () => {
    const here = `${window.location.pathname}${window.location.search}`
    expect(interceptableHref(clickOn({ href: here }))).toBeNull()
  })
})
