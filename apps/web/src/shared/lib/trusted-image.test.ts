import { describe, expect, it } from 'vitest'
import { isTrustedImageUrl } from './trusted-image'

describe('isTrustedImageUrl', () => {
  it('свой адрес, относительный путь и data/blob — доверенные', () => {
    expect(isTrustedImageUrl(`${window.location.origin}/img/a.png`)).toBe(true)
    expect(isTrustedImageUrl('/img/a.png')).toBe(true)
    expect(isTrustedImageUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isTrustedImageUrl('blob:abc')).toBe(true)
  })

  it('чужой хост — нет: картинка стала бы трекинг-пикселем', () => {
    expect(isTrustedImageUrl('https://evil.example/p.png')).toBe(false)
    expect(isTrustedImageUrl('//evil.example/p.png')).toBe(false)
    expect(isTrustedImageUrl('data:text/html,<b>x</b>')).toBe(false)
    expect(isTrustedImageUrl('')).toBe(false)
  })
})
