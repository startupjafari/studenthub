import { describe, expect, it } from 'vitest'
import { PROFILE_MEDIA_QUOTA, PROFILE_MEDIA_QUOTA_FIELD } from '@studenthub/shared-config'
import { mediaQuotaExceeded, mediaQuotaFromError, mediaQuotaNear, mediaUsage } from './media-quota'

const { MAX_FILES, MAX_BYTES } = PROFILE_MEDIA_QUOTA

// E-F26: квота медиа профиля на клиенте — проверка до отправки и разбор отказа сервера.
describe('квота медиа профиля', () => {
  it('использовано — число файлов и сумма размеров', () => {
    expect(mediaUsage([{ size: 10 }, { size: 32 }])).toEqual({ files: 2, bytes: 42 })
    expect(mediaUsage([])).toEqual({ files: 0, bytes: 0 })
  })

  it('последнее место по числу ещё есть, следующего — нет', () => {
    expect(mediaQuotaExceeded({ files: MAX_FILES - 1, bytes: 0 }, 1)).toBeNull()
    expect(mediaQuotaExceeded({ files: MAX_FILES, bytes: 0 }, 1)).toBe('files')
  })

  it('объём считается вместе с новым файлом', () => {
    expect(mediaQuotaExceeded({ files: 1, bytes: MAX_BYTES - 100 }, 100)).toBeNull()
    expect(mediaQuotaExceeded({ files: 1, bytes: MAX_BYTES - 100 }, 101)).toBe('bytes')
  })

  it('подсказка о заполненности — от 80 % любого предела', () => {
    expect(mediaQuotaNear({ files: 1, bytes: 0 })).toBe(false)
    expect(mediaQuotaNear({ files: MAX_FILES * 0.8, bytes: 0 })).toBe(true)
    expect(mediaQuotaNear({ files: 1, bytes: MAX_BYTES * 0.8 })).toBe(true)
  })

  it('отказ сервера по квоте узнаётся по полю в details, а не по тексту', () => {
    const files = {
      code: 'CONFLICT',
      details: [{ field: PROFILE_MEDIA_QUOTA_FIELD, message: 'files' }],
    }
    const bytes = {
      code: 'CONFLICT',
      details: [{ field: PROFILE_MEDIA_QUOTA_FIELD, message: 'bytes' }],
    }
    expect(mediaQuotaFromError(files)).toBe('files')
    expect(mediaQuotaFromError(bytes)).toBe('bytes')
    // Другой конфликт и другие коды — не квота: у них свой общий текст.
    expect(mediaQuotaFromError({ code: 'CONFLICT', message: 'x' })).toBeNull()
    expect(mediaQuotaFromError({ code: 'FILE_TOO_LARGE' })).toBeNull()
    expect(mediaQuotaFromError(new Error('network'))).toBeNull()
  })
})
