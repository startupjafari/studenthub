import { describe, expect, it } from 'vitest'
import { localMediaSrc } from './local-media-src'

describe('localMediaSrc', () => {
  it('blob-адрес из createObjectURL проходит как есть', () => {
    const url = 'blob:http://localhost:3000/0f8e8c4a-1d2b-4c3d-9e8f-1a2b3c4d5e6f'
    expect(localMediaSrc(url)).toBe(url)
    expect(localMediaSrc('blob:null/0f8e8c4a-1d2b-4c3d-9e8f-1a2b3c4d5e6f')).toBe(
      'blob:null/0f8e8c4a-1d2b-4c3d-9e8f-1a2b3c4d5e6f',
    )
  })

  it('другие схемы и пустое значение — нет', () => {
    expect(localMediaSrc('javascript:alert(1)')).toBeUndefined()
    expect(localMediaSrc('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(localMediaSrc('https://evil.example/a.mp4')).toBeUndefined()
    expect(localMediaSrc('/media/a.jpg')).toBeUndefined()
    expect(localMediaSrc('')).toBeUndefined()
    expect(localMediaSrc(null)).toBeUndefined()
    expect(localMediaSrc(undefined)).toBeUndefined()
  })

  it('blob: с HTML-метасимволами — нет', () => {
    expect(localMediaSrc('blob:x"><img src=x onerror=alert(1)>')).toBeUndefined()
    expect(localMediaSrc("blob:x'")).toBeUndefined()
    expect(localMediaSrc('blob:x&y')).toBeUndefined()
  })
})
