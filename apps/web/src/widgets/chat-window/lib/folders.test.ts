import { describe, expect, it } from 'vitest'
import type { ChatFolder, ChatListItem } from '../../../entities/chat'
import { buildFolderTabs, filterChatsByTab, folderTabLabel } from './folders'

function chat(id: string, type: ChatListItem['type'], unreadCount = 0): ChatListItem {
  return { id, type, unreadCount } as ChatListItem
}

// Непринятый входящий запрос на переписку (§50).
function request(id: string, unreadCount = 1): ChatListItem {
  return { id, type: 'PRIVATE', unreadCount, requestIncoming: true } as ChatListItem
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

describe('запросы на переписку (§50)', () => {
  const chats = [chat('c1', 'PRIVATE', 3), request('r1')]

  it('вкладка «Запросы» появляется только при входящем запросе', () => {
    expect(buildFolderTabs([chat('c1', 'PRIVATE')], []).map((t) => t.id)).not.toContain(
      'folderRequests',
    )
    expect(buildFolderTabs(chats, []).map((t) => t.id)).toContain('folderRequests')
  })

  it('«Запросы» отдают только непринятые входящие', () => {
    const tab = buildFolderTabs(chats, []).find((t) => t.id === 'folderRequests')
    expect(filterChatsByTab(chats, tab).map((c) => c.id)).toEqual(['r1'])
  })

  it('непринятый запрос не попадает ни в «Все», ни в «Личные», ни в «Непрочитанные»', () => {
    const tabs = buildFolderTabs(chats, [])
    for (const id of ['folderAll', 'folderPersonal', 'folderUnread']) {
      const tab = tabs.find((t) => t.id === id)
      expect(filterChatsByTab(chats, tab).map((c) => c.id)).toEqual(['c1'])
    }
  })

  it('непринятый запрос не всплывает и в пользовательской папке, даже если он в её составе', () => {
    const tab = buildFolderTabs(chats, [folder('f1', 'Учёба', ['c1', 'r1'])]).find(
      (t) => t.id === 'f1',
    )
    expect(filterChatsByTab(chats, tab).map((c) => c.id)).toEqual(['c1'])
  })

  it('тип-вкладка «Личные» не появляется ради одного непринятого запроса', () => {
    expect(buildFolderTabs([request('r1')], []).map((t) => t.id)).not.toContain('folderPersonal')
  })
})

describe('архив', () => {
  const archived = (id: string): ChatListItem =>
    ({ id, type: 'PRIVATE', unreadCount: 4, archived: true }) as ChatListItem
  const chats = [chat('c1', 'PRIVATE', 2), archived('a1')]

  it('вкладка «Архив» появляется, только когда в нём что-то есть', () => {
    expect(buildFolderTabs([chat('c1', 'PRIVATE')], []).map((t) => t.id)).not.toContain(
      'folderArchive',
    )
    expect(buildFolderTabs(chats, []).map((t) => t.id)).toContain('folderArchive')
  })

  it('архивный чат виден только в «Архиве» — ни в «Все», ни в «Непрочитанные»', () => {
    const tabs = buildFolderTabs(chats, [])
    const archiveTab = tabs.find((t) => t.id === 'folderArchive')
    expect(filterChatsByTab(chats, archiveTab).map((c) => c.id)).toEqual(['a1'])
    for (const id of ['folderAll', 'folderPersonal', 'folderUnread']) {
      expect(
        filterChatsByTab(
          chats,
          tabs.find((t) => t.id === id),
        ).map((c) => c.id),
      ).toEqual(['c1'])
    }
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
