import { describe, expect, it } from 'vitest'
import type { ChatFolder, ChatListItem } from '../../../entities/chat'
import { buildFolderTabs, filterChatsByTab, folderTabLabel } from './folders'

function chat(id: string, type: ChatListItem['type'], unreadCount = 0): ChatListItem {
  return { id, type, unreadCount } as ChatListItem
}

function folder(id: string, name: string, chatIds: string[], position = 0): ChatFolder {
  return { id, name, chatIds, position }
}

describe('buildFolderTabs', () => {
  it('пустые встроенные тип-папки не показываются, «Все» и «Непрочитанные» — всегда', () => {
    const tabs = buildFolderTabs([chat('c1', 'PRIVATE')], [])
    expect(tabs.map((t) => t.id)).toEqual(['folderAll', 'folderUnread', 'folderPersonal'])
  })

  it('пользовательские папки идут после встроенных и в порядке position', () => {
    const tabs = buildFolderTabs(
      [chat('c1', 'PRIVATE')],
      [folder('f2', 'Кураторы', [], 1), folder('f1', 'Учёба', ['c1'], 0)],
    )
    expect(tabs.map((t) => t.id)).toEqual([
      'folderAll',
      'folderUnread',
      'folderPersonal',
      'f1',
      'f2',
    ])
  })

  it('пустая пользовательская папка остаётся вкладкой — её создали намеренно', () => {
    const tabs = buildFolderTabs([chat('c1', 'PRIVATE')], [folder('f1', 'Пустая', [])])
    expect(tabs.some((t) => t.id === 'f1')).toBe(true)
  })
})

describe('filterChatsByTab', () => {
  const chats = [chat('c1', 'PRIVATE', 2), chat('c2', 'SUBJECT'), chat('c3', 'GROUP')]

  it('«Все» отдаёт список без изменений', () => {
    const tabs = buildFolderTabs(chats, [])
    expect(filterChatsByTab(chats, tabs[0])).toHaveLength(3)
  })

  it('«Непрочитанные» — только с непрочитанными', () => {
    const tab = buildFolderTabs(chats, []).find((t) => t.id === 'folderUnread')
    expect(filterChatsByTab(chats, tab).map((c) => c.id)).toEqual(['c1'])
  })

  it('тип-папка фильтрует по типу чата', () => {
    const tab = buildFolderTabs(chats, []).find((t) => t.id === 'folderSubjects')
    expect(filterChatsByTab(chats, tab).map((c) => c.id)).toEqual(['c2'])
  })

  it('пользовательская папка фильтрует по составу', () => {
    const tab = buildFolderTabs(chats, [folder('f1', 'Учёба', ['c2', 'c3'])]).find(
      (t) => t.id === 'f1',
    )
    expect(filterChatsByTab(chats, tab).map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('исчезнувшая вкладка (папку удалили с другого устройства) = «Все», а не пустой экран', () => {
    expect(filterChatsByTab(chats, undefined)).toHaveLength(3)
  })
})

describe('folderTabLabel', () => {
  it('встроенная переводится по ключу, пользовательская — своё имя', () => {
    const [all] = buildFolderTabs([], [])
    expect(folderTabLabel(all!, (k) => `t:${k}`)).toBe('t:folderAll')
    expect(
      folderTabLabel({ id: 'f1', kind: 'user', name: 'Учёба', chatIds: [] }, (k) => `t:${k}`),
    ).toBe('Учёба')
  })
})
