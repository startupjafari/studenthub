import { describe, expect, it } from 'vitest'
import { toMediaLink } from './media'

describe('toMediaLink', () => {
  it('голая строка (API до медиа-системы) — оригинал без вариантов', () => {
    expect(toMediaLink('https://minio/a.jpg')).toMatchObject({
      url: 'https://minio/a.jpg',
      status: 'NONE',
      sources: [],
      poster: [],
      hls: null,
      placeholder: null,
    })
  })

  it('{ url } без описания — тоже без вариантов', () => {
    expect(toMediaLink({ url: 'https://minio/a.jpg' }).sources).toEqual([])
  })

  it('полное описание проходит как есть', () => {
    const link = toMediaLink({
      url: 'https://minio/v.mp4',
      expiresAt: '2026-10-16T10:15:00.000Z',
      status: 'READY',
      hls: '/api/v1/media/x/hls/master.m3u8?t=t',
      poster: [{ width: 640, height: 360, url: 'https://minio/p.webp' }],
    })
    expect(link.status).toBe('READY')
    expect(link.hls).toContain('master.m3u8')
    expect(link.poster).toHaveLength(1)
  })
})
