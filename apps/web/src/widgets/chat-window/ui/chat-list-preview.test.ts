import { describe, expect, it } from 'vitest'
import type { MessageAttachment } from '../../../entities/chat'
import { singleMediaName } from './chat-list-preview'

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
