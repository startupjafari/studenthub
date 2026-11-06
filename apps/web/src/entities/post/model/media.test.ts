import { describe, expect, it } from 'vitest'
import { inlineMediaLink } from './media'
import type { PostMedia } from './types'

const NOW = Date.parse('2026-10-17T10:00:00.000Z')

const media = (o: Partial<PostMedia> = {}): PostMedia => ({
  id: 'f1',
  mime: 'image/jpeg',
  width: 1200,
  height: 800,
  placeholder: 'data:image/webp;base64,xx',
  mediaStatus: 'READY',
  ...o,
})

describe('inlineMediaLink', () => {
  it('ссылка из выдачи с вариантами — запрос за ней не нужен', () => {
    const link = inlineMediaLink(
      media({
        url: 'https://minio/f1',
        expiresAt: '2026-10-17T10:15:00.000Z',
        status: 'READY',
        sources: [{ width: 640, height: 427, url: 'https://minio/f1-640' }],
        poster: [],
        hls: null,
      }),
      NOW,
    )
    expect(link).toMatchObject({
      url: 'https://minio/f1',
      status: 'READY',
      width: 1200,
      sources: [{ width: 640, height: 427, url: 'https://minio/f1-640' }],
    })
  })

  it('ответ старого API без ссылки → null (ссылку даст отдельная ручка)', () => {
    expect(inlineMediaLink(media(), NOW)).toBeNull()
  })

  it('истекшая или истекающая в ближайшую минуту ссылка → null (продлить)', () => {
    expect(
      inlineMediaLink(
        media({ url: 'https://minio/f1', expiresAt: '2026-10-17T09:59:00.000Z' }),
        NOW,
      ),
    ).toBeNull()
    expect(
      inlineMediaLink(
        media({ url: 'https://minio/f1', expiresAt: '2026-10-17T10:00:30.000Z' }),
        NOW,
      ),
    ).toBeNull()
  })

  it('без срока (постоянная ссылка) — годится', () => {
    expect(inlineMediaLink(media({ url: 'https://cdn/f1', expiresAt: null }), NOW)?.url).toBe(
      'https://cdn/f1',
    )
  })
})
