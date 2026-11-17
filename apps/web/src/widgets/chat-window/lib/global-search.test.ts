import { describe, expect, it } from 'vitest'
import type { ChatMessage, MessageAttachment } from '../../../entities/chat'
import {
  SEARCH_TABS,
  SEARCH_TAB_KEY,
  attachmentHits,
  attachmentMatchesKind,
  formatClock,
  hostOf,
  linkHits,
  linkOf,
} from './global-search'

const att = (mime: string, name: string | null, extra: Partial<MessageAttachment> = {}) =>
  ({ id: `${mime}:${name}`, mime, name, size: 1, ...extra }) as MessageAttachment

const msg = (id: string, patch: Partial<ChatMessage> = {}) =>
  ({ id, chatId: 'c1', content: '', media: [], linkPreview: null, ...patch }) as ChatMessage

describe('attachmentMatchesKind — те же правила, что у сервера', () => {
  const cases: [MessageAttachment, string[]][] = [
    [att('image/jpeg', 'IMG.jpg'), ['media']],
    [att('image/png', null), ['media']],
    [att('video/mp4', 'clip.mp4'), ['media']],
    // «Без сжатия» — строка файла, как в переписке.
    [att('image/jpeg', 'scan.jpg', { asDocument: true }), ['file']],
    [att('application/pdf', 'Курсовая.pdf'), ['file']],
    [att('audio/webm', 'voice-msg.webm'), ['voice']],
    // Веб пишет голосовое в webm, браузер отдаёт его как video/webm — это не видео.
    [att('video/webm', 'voice-msg.webm'), ['voice']],
    [att('audio/mpeg', 'track.mp3'), ['music']],
    [att('audio/mpeg', null), ['music']],
  ]
  it.each(cases)('%o → %j', (a, kinds) => {
    const matched = (['media', 'file', 'voice', 'music'] as const).filter((k) =>
      attachmentMatchesKind(a, k),
    )
    expect(matched).toEqual(kinds)
  })
})

describe('attachmentHits', () => {
  it('из альбома — только вложения вкладки, в порядке выдачи', () => {
    const photo = att('image/jpeg', 'a.jpg')
    const pdf = att('application/pdf', 'b.pdf')
    const m1 = msg('m1', { media: [photo, pdf] })
    const m2 = msg('m2', { media: [att('application/zip', 'c.zip')] })
    expect(attachmentHits([m1, m2], 'file').map((h) => [h.message.id, h.attachment.name])).toEqual([
      ['m1', 'b.pdf'],
      ['m2', 'c.zip'],
    ])
    expect(attachmentHits([m1, m2], 'media').map((h) => h.attachment)).toEqual([photo])
  })
})

describe('ссылки', () => {
  it('превью сервера важнее адреса в тексте', () => {
    const m = msg('m1', {
      content: 'см. https://a.example/x',
      linkPreview: {
        url: 'https://b.example/y',
        title: 'Заголовок',
        siteName: 'B',
      } as ChatMessage['linkPreview'],
    })
    expect(linkOf(m)).toEqual({ url: 'https://b.example/y', title: 'Заголовок', site: 'B' })
  })

  it('без превью — первый адрес из текста; без ссылки сообщение пропускается', () => {
    const withUrl = msg('m1', { content: 'читай http://www.kaznu.kz/news?id=1 сегодня' })
    const plain = msg('m2', { content: 'без ссылок' })
    expect(linkHits([withUrl, plain]).map((h) => [h.message.id, h.url])).toEqual([
      ['m1', 'http://www.kaznu.kz/news?id=1'],
    ])
    expect(hostOf('http://www.kaznu.kz/news?id=1')).toBe('kaznu.kz')
    expect(hostOf('не адрес')).toBe('не адрес')
  })
})

describe('formatClock', () => {
  it('м:сс, от часа — ч:мм:сс', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65_400)).toBe('1:05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })
})

describe('вкладки', () => {
  it('у каждой вкладки есть подпись, порядок как в Telegram', () => {
    expect(SEARCH_TABS).toEqual(['chats', 'media', 'link', 'file', 'music', 'voice'])
    for (const tab of SEARCH_TABS) expect(SEARCH_TAB_KEY[tab]).toBeTruthy()
  })
})
