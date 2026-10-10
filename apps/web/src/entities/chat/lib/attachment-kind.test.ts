import { describe, expect, it } from 'vitest'
import type { MessageAttachment } from '../model/types'
import { attachmentKind, mediaPreview } from './attachment-kind'

const att = (over: Partial<MessageAttachment>): MessageAttachment =>
  ({ id: 'a', mime: 'application/zip', size: 1, ...over }) as MessageAttachment

describe('attachmentKind', () => {
  it('голосовое узнаётся по имени рекордера, а не по mime', () => {
    // mime у записи непредсказуем: webm → video/webm, iOS → video/mp4.
    expect(attachmentKind(att({ name: 'voice-123.webm', mime: 'video/webm' }))).toBe('voice')
    expect(attachmentKind(att({ name: 'voice-1.m4a', mime: 'video/mp4' }))).toBe('voice')
  })

  it('старые голосовые — по mime', () => {
    expect(attachmentKind(att({ mime: 'audio/ogg' }))).toBe('voice')
  })

  it('фото и видео', () => {
    expect(attachmentKind(att({ mime: 'image/png' }))).toBe('photo')
    expect(attachmentKind(att({ mime: 'video/mp4' }))).toBe('video')
  })

  // Снимок, отправленный «без сжатия», получатель видит строкой файла — превью обязано
  // говорить то же самое, иначе список обещает фото, а в чате лежит файл.
  it('картинка «без сжатия» — файл', () => {
    expect(attachmentKind(att({ mime: 'image/png', asDocument: true }))).toBe('file')
  })

  it('всё остальное — файл', () => {
    expect(attachmentKind(att({ mime: 'application/pdf' }))).toBe('file')
  })
})

describe('mediaPreview', () => {
  it('без вложений — ничего', () => {
    expect(mediaPreview([])).toBeNull()
  })

  it('одно вложение: вид и единица', () => {
    expect(mediaPreview([att({ mime: 'image/png' })])).toEqual({ kind: 'photo', count: 1 })
  })

  it('однородный альбом считается', () => {
    const media = [att({ mime: 'image/png' }), att({ mime: 'image/jpeg' })]
    expect(mediaPreview(media)).toEqual({ kind: 'photo', count: 2 })
  })

  // «3 фото» про набор из снимка, ролика и архива было бы враньём.
  it('разнородный набор сводится к файлам', () => {
    const media = [
      att({ mime: 'image/png' }),
      att({ mime: 'video/mp4' }),
      att({ mime: 'application/zip' }),
    ]
    expect(mediaPreview(media)).toEqual({ kind: 'file', count: 3 })
  })
})
