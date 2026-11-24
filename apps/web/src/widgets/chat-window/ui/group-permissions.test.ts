import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_PERMISSIONS } from '@studenthub/shared-schemas'
import type { ChatListItem } from '../../../entities/chat'
import { allowedCount, chatPermissionsOf } from './group-permissions'

// «Разрешения» группы на клиенте (§8.3): старый сервер без поля — умолчания; выключенное
// «писать» гасит зависимые права и в счётчике строки.

const chat = (permissions: ChatListItem['permissions']) =>
  ({ id: 'c1', type: 'GROUP', permissions }) as ChatListItem

describe('chatPermissionsOf / allowedCount', () => {
  it('без поля (старый сервер) — умолчания: 5 из 7', () => {
    expect(chatPermissionsOf(chat(undefined))).toEqual(DEFAULT_CHAT_PERMISSIONS)
    expect(allowedCount(chat(undefined))).toBe(5)
  })

  it('«писать» выключено — медиа, ссылки и опросы тоже', () => {
    const p = chatPermissionsOf(chat({ ...DEFAULT_CHAT_PERMISSIONS, sendMessages: false }))
    expect(p.sendMedia || p.embedLinks || p.sendPolls).toBe(false)
    // Остались закреп (по умолчанию открыт) и ничего больше.
    expect(allowedCount(chat({ ...DEFAULT_CHAT_PERMISSIONS, sendMessages: false }))).toBe(1)
  })
})
