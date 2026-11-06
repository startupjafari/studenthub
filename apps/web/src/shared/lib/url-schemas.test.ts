import { describe, expect, it } from 'vitest'
import { WebsiteSchema, httpUrl, websiteHref } from '@studenthub/shared-schemas'

// Схемы живут в shared-schemas, а проверяются здесь: своего раннера у пакета нет.
describe('ссылки из пользовательских полей', () => {
  it('httpUrl пропускает только http(s)', () => {
    const schema = httpUrl(500)
    expect(schema.safeParse('https://example.kz/a').success).toBe(true)
    expect(schema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(schema.safeParse('data:text/html,<b>x</b>').success).toBe(false)
  })

  it('сайт в профиле: ссылка или голый домен, но не //host и не чужая схема', () => {
    expect(WebsiteSchema.safeParse('').success).toBe(true)
    expect(WebsiteSchema.safeParse('example.kz').success).toBe(true)
    expect(WebsiteSchema.safeParse('https://example.kz/путь').success).toBe(true)
    expect(WebsiteSchema.safeParse('//login-studenthub.evil').success).toBe(false)
    expect(WebsiteSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })

  it('websiteHref: голому домену — https, сомнительное — не ссылка', () => {
    expect(websiteHref('example.kz')).toBe('https://example.kz')
    expect(websiteHref('http://example.kz')).toBe('http://example.kz')
    expect(websiteHref('//login-studenthub.evil')).toBeNull()
    expect(websiteHref('')).toBeNull()
  })
})
