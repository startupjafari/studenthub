import { describe, expect, it, vi } from 'vitest'
import type { MessageAttachment } from '../../../entities/chat'

const supported = vi.hoisted(() => ({ value: true }))
vi.mock('../../../shared/lib/emoji-support', () => ({
  isEmojiSupported: () => supported.value,
}))

import { singleMediaName, stickerPreviewEmoji } from './chat-list-preview'

const att = (over: Partial<MessageAttachment>): MessageAttachment =>
  ({ id: 'a', mime: 'application/pdf', size: 1, ...over }) as MessageAttachment

describe('singleMediaName', () => {
  // Telegram подписывает документ в списке его именем, а не словом «Файл».
  it('единственный документ — его имя', () => {
    expect(singleMediaName([att({ name: 'Лекция 3.pdf' })])).toBe('Лекция 3.pdf')
  })

  it('песня — название без расширения', () => {
    expect(singleMediaName([att({ name: 'Подкаст выпуск 4.mp3', mime: 'audio/mpeg' })])).toBe(
      'Подкаст выпуск 4',
    )
  })

  it('фото, голосовое, альбом и файл без имени — нет имени', () => {
    expect(singleMediaName([att({ name: 'IMG_1.jpg', mime: 'image/jpeg' })])).toBeNull()
    expect(singleMediaName([att({ name: 'voice-1.ogg', mime: 'audio/ogg' })])).toBeNull()
    expect(singleMediaName([att({ name: 'a.pdf' }), att({ name: 'b.pdf' })])).toBeNull()
    expect(singleMediaName([att({ name: '  ' })])).toBeNull()
    expect(singleMediaName([])).toBeNull()
  })
})

describe('stickerPreviewEmoji', () => {
  it('смайл, который система рисует, — перед подписью', () => {
    supported.value = true
    expect(stickerPreviewEmoji('🙂')).toBe('🙂 ')
  })

  // Вместо «□ Стикер» — просто «Стикер».
  it('нераспознанный шрифтом смайл не показывается', () => {
    supported.value = false
    expect(stickerPreviewEmoji('🫥')).toBe('')
  })

  it('без эмодзи — пусто', () => {
    expect(stickerPreviewEmoji(null)).toBe('')
  })
})
