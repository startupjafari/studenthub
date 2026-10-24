import { describe, expect, it } from 'vitest'
import { pickSource, srcSetOf } from './media-source'

const sources = [
  { width: 320, height: 240, url: 'https://cdn/w320.webp' },
  { width: 640, height: 480, url: 'https://cdn/w640.webp' },
  { width: 1280, height: 960, url: 'https://cdn/w1280.webp' },
]

describe('srcSetOf', () => {
  it('собирает srcset из копий по возрастанию ширины', () => {
    expect(srcSetOf(sources)).toBe(
      'https://cdn/w320.webp 320w, https://cdn/w640.webp 640w, https://cdn/w1280.webp 1280w',
    )
  })

  it('оригинал шире всех копий — последний кандидат', () => {
    expect(srcSetOf(sources, { url: 'https://cdn/orig.jpg', width: 4032 })).toMatch(
      /w1280\.webp 1280w, https:\/\/cdn\/orig\.jpg 4032w$/,
    )
  })

  it('оригинал не шире копий или без ширины — не добавляется', () => {
    expect(srcSetOf(sources, { url: 'https://cdn/orig.jpg', width: 1000 })).not.toContain('orig')
    expect(srcSetOf(sources, { url: 'https://cdn/orig.jpg' })).not.toContain('orig')
  })

  it('копий нет — srcset не нужен вовсе (грузится оригинал)', () => {
    expect(srcSetOf([], { url: 'https://cdn/orig.jpg', width: 4032 })).toBeUndefined()
    expect(srcSetOf(undefined)).toBeUndefined()
  })
})

describe('pickSource', () => {
  it('самая маленькая копия не уже требуемой', () => {
    expect(pickSource(sources, 500)?.width).toBe(640)
  })

  it('все уже — берётся самая крупная', () => {
    expect(pickSource(sources, 4000)?.width).toBe(1280)
  })

  it('пусто — undefined', () => {
    expect(pickSource([], 100)).toBeUndefined()
  })
})
