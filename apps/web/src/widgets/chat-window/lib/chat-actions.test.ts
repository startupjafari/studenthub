import { describe, expect, it } from 'vitest'
import {
  ACTION_REPEAT_MS,
  ACTION_TTL_MS,
  applyAction,
  summarizeActors,
  sweepActions,
  uploadActionOf,
  type ActionsByChat,
} from './chat-actions'

const file = (name: string, type: string) => ({ name, type })

describe('applyAction', () => {
  it('записывает действие участника', () => {
    const next = applyAction({}, 'c1', 'u1', 'TYPING', 1000)
    expect(next).toEqual({ c1: { u1: { action: 'TYPING', ts: 1000 } } })
  })

  it('обновляет действие и время того же участника', () => {
    const first = applyAction({}, 'c1', 'u1', 'TYPING', 1000)
    const second = applyAction(first, 'c1', 'u1', 'RECORDING_VOICE', 2000)
    expect(second.c1?.u1).toEqual({ action: 'RECORDING_VOICE', ts: 2000 })
    expect(Object.keys(second.c1 ?? {})).toHaveLength(1)
  })

  it('null убирает участника, остальные остаются', () => {
    let state: ActionsByChat = {}
    state = applyAction(state, 'c1', 'u1', 'TYPING', 1000)
    state = applyAction(state, 'c1', 'u2', 'TYPING', 1000)
    state = applyAction(state, 'c1', 'u1', null, 1500)
    expect(Object.keys(state.c1 ?? {})).toEqual(['u2'])
  })

  it('чат исчезает, когда в нём никого не осталось', () => {
    const state = applyAction(applyAction({}, 'c1', 'u1', 'TYPING', 1000), 'c1', 'u1', null, 1500)
    expect(state).toEqual({})
  })

  it('стоп от того, кого и не было, ничего не меняет', () => {
    const state: ActionsByChat = { c1: { u1: { action: 'TYPING', ts: 1000 } } }
    expect(applyAction(state, 'c1', 'u2', null, 1500)).toBe(state)
  })

  it('чаты не мешают друг другу', () => {
    let state: ActionsByChat = {}
    state = applyAction(state, 'c1', 'u1', 'TYPING', 1000)
    state = applyAction(state, 'c2', 'u1', 'UPLOADING_PHOTO', 1000)
    expect(state.c1?.u1?.action).toBe('TYPING')
    expect(state.c2?.u1?.action).toBe('UPLOADING_PHOTO')
  })
})

describe('sweepActions', () => {
  it('убирает подписи, которые давно не подтверждали', () => {
    const state: ActionsByChat = {
      c1: { u1: { action: 'TYPING', ts: 1000 }, u2: { action: 'TYPING', ts: 5000 } },
    }
    const next = sweepActions(state, 5500)
    expect(Object.keys(next.c1 ?? {})).toEqual(['u2'])
  })

  it('подпись живёт ровно до TTL', () => {
    const state: ActionsByChat = { c1: { u1: { action: 'TYPING', ts: 1000 } } }
    expect(sweepActions(state, 1000 + ACTION_TTL_MS - 1)).toBe(state)
    expect(sweepActions(state, 1000 + ACTION_TTL_MS)).toEqual({})
  })

  it('повтор приходит раньше, чем гаснет подпись', () => {
    // Иначе подпись мигала бы: гасла и зажигалась между подтверждениями.
    expect(ACTION_REPEAT_MS).toBeLessThan(ACTION_TTL_MS)
  })

  it('возвращает тот же объект, когда убирать нечего', () => {
    const state: ActionsByChat = { c1: { u1: { action: 'TYPING', ts: 1000 } } }
    expect(sweepActions(state, 1500)).toBe(state)
  })
})

describe('summarizeActors', () => {
  it('пусто → подписи нет', () => {
    expect(summarizeActors(undefined)).toBeNull()
    expect(summarizeActors({})).toBeNull()
  })

  it('один участник → его действие и он сам', () => {
    expect(summarizeActors({ u1: { action: 'RECORDING_VOICE', ts: 1 } })).toEqual({
      kind: 'single',
      action: 'RECORDING_VOICE',
      userId: 'u1',
    })
  })

  it('все делают одно и то же → множественная форма этого действия', () => {
    const summary = summarizeActors({
      u1: { action: 'TYPING', ts: 2 },
      u2: { action: 'TYPING', ts: 1 },
    })
    expect(summary).toEqual({ kind: 'same', action: 'TYPING', count: 2, firstUserId: 'u2' })
  })

  it('разные действия → разнобой, без перечисления', () => {
    const summary = summarizeActors({
      u1: { action: 'TYPING', ts: 1 },
      u2: { action: 'UPLOADING_PHOTO', ts: 2 },
      u3: { action: 'RECORDING_VOICE', ts: 3 },
    })
    expect(summary).toEqual({ kind: 'mixed', count: 3, firstUserId: 'u1' })
  })

  it('первым считается начавший раньше, а не первый по ключу', () => {
    const summary = summarizeActors({
      zzz: { action: 'TYPING', ts: 1 },
      aaa: { action: 'TYPING', ts: 9 },
    })
    expect(summary).toMatchObject({ firstUserId: 'zzz' })
  })
})

describe('uploadActionOf', () => {
  it('только снимки → фото', () => {
    expect(uploadActionOf([file('a.jpg', 'image/jpeg'), file('b.png', 'image/png')])).toBe(
      'UPLOADING_PHOTO',
    )
  })

  it('только ролики → видео', () => {
    expect(uploadActionOf([file('a.mp4', 'video/mp4')])).toBe('UPLOADING_VIDEO')
  })

  it('снимки с роликами → фото: это медиа-альбом, а не файлы', () => {
    expect(uploadActionOf([file('a.jpg', 'image/jpeg'), file('b.mp4', 'video/mp4')])).toBe(
      'UPLOADING_PHOTO',
    )
  })

  it('документ → файл', () => {
    expect(uploadActionOf([file('отчёт.pdf', 'application/pdf')])).toBe('UPLOADING_FILE')
  })

  it('аудиофайл → файл: отдельного действия под него нет', () => {
    expect(uploadActionOf([file('песня.mp3', 'audio/mpeg')])).toBe('UPLOADING_FILE')
  })

  it('картинка вперемешку с документом → файл', () => {
    expect(uploadActionOf([file('a.jpg', 'image/jpeg'), file('b.pdf', 'application/pdf')])).toBe(
      'UPLOADING_FILE',
    )
  })

  it('голосовое → ничего: подпись уже была «записывает голосовое…»', () => {
    expect(uploadActionOf([file('voice-msg.webm', 'audio/webm')])).toBeNull()
  })

  it('пустой набор → ничего', () => {
    expect(uploadActionOf([])).toBeNull()
  })
})
