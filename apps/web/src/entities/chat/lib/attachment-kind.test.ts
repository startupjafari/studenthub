import { describe, expect, it } from 'vitest'
import type { MessageAttachment } from '../model/types'
import {
  attachmentKind,
  isAnimation,
  isMusic,
  isVideoNote,
  isViewable,
  isVoice,
  mediaPreview,
} from './attachment-kind'

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

  // GIF как в Telegram: и переведённый в MP4, и старый image/gif — «GIF», а не «Видео»/«Фото».
  it('GIF — анимация-MP4 и старый image/gif', () => {
    expect(attachmentKind(att({ mime: 'video/mp4', animation: true }))).toBe('gif')
    expect(attachmentKind(att({ mime: 'image/gif' }))).toBe('gif')
    expect(isAnimation(att({ mime: 'video/mp4', animation: true }))).toBe(true)
    expect(isAnimation(att({ mime: 'image/gif', animation: true }))).toBe(false)
    // «Без сжатия» перевешивает: строка файла.
    expect(attachmentKind(att({ mime: 'image/gif', asDocument: true }))).toBe('file')
  })

  // Снимок, отправленный «без сжатия», получатель видит строкой файла — превью обязано
  // говорить то же самое, иначе список обещает фото, а в чате лежит файл.
  it('картинка «без сжатия» — файл', () => {
    expect(attachmentKind(att({ mime: 'image/png', asDocument: true }))).toBe('file')
  })

  it('всё остальное — файл', () => {
    expect(attachmentKind(att({ mime: 'application/pdf' }))).toBe('file')
  })

  // Кружок пишется тем же MediaRecorder, что голосовое, и тоже приходит как video/webm —
  // запасная эвристика «webm — голосовое» не должна его перехватить.
  it('кружок — отдельный вид, а не голосовое и не видео', () => {
    const round = att({ name: 'round-1.webm', mime: 'video/webm', videoNote: true })
    expect(isVoice(round)).toBe(false)
    expect(isVideoNote(round)).toBe(true)
    expect(attachmentKind(round)).toBe('round')
    expect(mediaPreview([round])).toEqual({ kind: 'round', count: 1 })
  })

  // Telegram различает голосовое (волна) и музыку (строка с названием) — и в пузыре, и в списке.
  it('аудиофайл с названием — музыка, запись рекордера и звук без имени — голосовое', () => {
    const song = att({ name: 'Подкаст выпуск 4.mp3', mime: 'audio/mpeg' })
    expect(isVoice(song)).toBe(true)
    expect(isMusic(song)).toBe(true)
    expect(attachmentKind(song)).toBe('audio')
    expect(isMusic(att({ name: 'voice-001.ogg', mime: 'audio/ogg' }))).toBe(false)
    expect(isMusic(att({ mime: 'audio/ogg' }))).toBe(false)
    expect(isMusic(att({ name: 'doc.pdf', mime: 'application/pdf' }))).toBe(false)
  })

  // Раньше любой video/webm считался голосовым — ролик «Демо проекта.webm» рисовался волной.
  it('webm с размерами кадра — видео, без размеров — старое голосовое', () => {
    const clip = att({ name: 'Демо проекта.webm', mime: 'video/webm', width: 480, height: 270 })
    expect(isVoice(clip)).toBe(false)
    expect(isViewable(clip)).toBe(true)
    expect(attachmentKind(clip)).toBe('video')
    expect(attachmentKind(att({ mime: 'video/webm' }))).toBe('voice')
  })

  it('флаг кружка на не-видео ничего не меняет', () => {
    expect(attachmentKind(att({ mime: 'image/png', videoNote: true }))).toBe('photo')
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
