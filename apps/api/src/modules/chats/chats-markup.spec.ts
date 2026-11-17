import { firstLinkUrl } from '@studenthub/shared-schemas'

// Разметка сообщения (PROJECT.md §3.6) сервер не разбирает: текст хранится как написан, в
// push и письма не уходит. Единственное место, где сервер читает адрес из текста, — превью
// ссылки, и маркер спойлера `||` не должен прилипать к адресу.
describe('firstLinkUrl — адрес для превью ссылки', () => {
  it('голый адрес', () => {
    expect(firstLinkUrl('смотри https://studenthub.kz/a?b=1 тут')).toBe(
      'https://studenthub.kz/a?b=1',
    )
  })

  it('адрес в спойлере — без закрывающего маркера', () => {
    expect(firstLinkUrl('ответ: ||https://studenthub.kz/x||')).toBe('https://studenthub.kz/x')
    expect(firstLinkUrl('||см. https://studenthub.kz||.')).toBe('https://studenthub.kz')
  })

  it('плюсы в конце адреса — часть адреса', () => {
    expect(firstLinkUrl('https://en.wikipedia.org/wiki/C++')).toBe(
      'https://en.wikipedia.org/wiki/C++',
    )
  })

  it('без адреса — ничего', () => {
    expect(firstLinkUrl('||спойлер||')).toBeUndefined()
    expect(firstLinkUrl(undefined)).toBeUndefined()
  })
})
