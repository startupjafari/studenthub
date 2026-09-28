import { describe, expect, it } from 'vitest'
import { parseMessage, type Token } from './markup'

// Разбор текста сообщения. Проверяется без DOM: правила разметки — это про строки, а не
// про отрисовку, и ловить их ошибки удобнее там, где видно сами части.
//
// Главное правило всех этих случаев одно: сообщение НИКОГДА не теряет символов. Разметка
// в переписке бывает битой, и разбор обязан в худшем случае оставить текст как есть.

/** Видимый текст всех частей: по нему проверяется, что разбор ничего не проглотил. */
function plain(tokens: Token[]): string {
  return tokens.map((token) => token.text).join('')
}

describe('разбор сообщения', () => {
  it('обычный текст остаётся одной частью', () => {
    expect(parseMessage('Добрый день, помогите с доступом')).toEqual([
      { kind: 'text', text: 'Добрый день, помогите с доступом' },
    ])
  })

  it('голый адрес становится ссылкой', () => {
    expect(parseMessage('Смотри https://studenthub.kz тут')).toEqual([
      { kind: 'text', text: 'Смотри ' },
      { kind: 'link', text: 'https://studenthub.kz', href: 'https://studenthub.kz' },
      { kind: 'text', text: ' тут' },
    ])
  })

  // Угловые скобки — разметка markdown, а не часть адреса: раньше их читали как текст.
  it('снимает угловые скобки с адреса', () => {
    expect(parseMessage('<https://google.com>')).toEqual([
      { kind: 'link', text: 'https://google.com', href: 'https://google.com' },
    ])
  })

  it('из [текста](адреса) показывает текст', () => {
    expect(parseMessage('[сайт](http://example.com)')).toEqual([
      { kind: 'link', text: 'сайт', href: 'http://example.com' },
    ])
  })

  // Без схемы браузер счёл бы адрес относительным путём и увёл бы на сам мини-апп.
  it('адресу с www дописывает схему', () => {
    const [token] = parseMessage('www.example.com')
    expect(token).toEqual({
      kind: 'link',
      text: 'www.example.com',
      href: 'https://www.example.com',
    })
  })

  /** Точка в конце фразы — не часть адреса: открытая с ней ссылка ведёт в никуда. */
  it('не забирает в ссылку знак конца предложения', () => {
    expect(parseMessage('Зайди на https://studenthub.kz.')).toEqual([
      { kind: 'text', text: 'Зайди на ' },
      { kind: 'link', text: 'https://studenthub.kz', href: 'https://studenthub.kz' },
      { kind: 'text', text: '.' },
    ])
  })

  it('оставляет закрывающую скобку внутри адреса, если она парная', () => {
    const [token] = parseMessage('https://ru.wikipedia.org/wiki/Кант_(значения)')
    expect(token).toMatchObject({
      kind: 'link',
      text: 'https://ru.wikipedia.org/wiki/Кант_(значения)',
    })
  })

  it('разбирает выделение и код', () => {
    expect(parseMessage('**важно** и `код`')).toEqual([
      { kind: 'bold', text: 'важно' },
      { kind: 'text', text: ' и ' },
      { kind: 'code', text: 'код' },
    ])
  })

  // Звёздочка между пробелами — умножение, а не разметка.
  it('не принимает умножение за наклонный текст', () => {
    expect(parseMessage('5 * 3 * 2')).toEqual([{ kind: 'text', text: '5 * 3 * 2' }])
  })

  it('битую разметку оставляет текстом', () => {
    expect(parseMessage('[сайт](не адрес) и **незакрытое')).toEqual([
      { kind: 'text', text: '[сайт](не адрес) и **незакрытое' },
    ])
  })

  it('переводы строк не теряются', () => {
    expect(parseMessage('Первое\nВторое')).toEqual([{ kind: 'text', text: 'Первое\nВторое' }])
  })

  it('ни один символ не пропадает', () => {
    const text = 'Привет @username, глянь #новости и <https://example.com/a?b=1> — **срочно**'
    expect(plain(parseMessage(text)).length).toBeGreaterThan(0)
    expect(plain(parseMessage(text))).toContain('@username')
    expect(plain(parseMessage(text))).toContain('#новости')
  })
})
