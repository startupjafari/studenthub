import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion } from './compare-versions'
import { latestModalNote, pickReleaseNote } from './pick-note'
import type { ReleaseNote } from '../model/types'

function note(version: string, date: string, showModal = true): ReleaseNote {
  return {
    version,
    date,
    showModal,
    content: { ru: { title: `v${version}`, sections: [] } },
  }
}

const NOTES = [
  note('1.9.0', '2026-09-01'),
  note('1.10.0', '2026-09-10'),
  note('1.10.1', '2026-09-12', false),
]

describe('compareVersions', () => {
  it('сравнивает числами, а не строками: 1.10.0 новее 1.9.0', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })
})

describe('latestModalNote', () => {
  it('берёт самую новую ноту с показом окна, а не последнюю по порядку', () => {
    expect(latestModalNote(NOTES)?.version).toBe('1.10.0')
  })

  it('нет ни одной ноты с показом — окна нет', () => {
    expect(latestModalNote([note('1.0.0', '2026-01-01', false)])).toBeNull()
  })
})

describe('pickReleaseNote', () => {
  const old = { version: null, seenAt: null, accountCreatedAt: '2026-01-01T00:00:00.000Z' }

  it('молчит, пока состояние не загружено', () => {
    expect(pickReleaseNote(NOTES, undefined)).toBeNull()
  })

  it('показывает ноту тому, кто её ещё не видел', () => {
    expect(pickReleaseNote(NOTES, old)).toEqual({ note: NOTES[1], action: 'show' })
  })

  it('молчит, если версия уже подтверждена', () => {
    expect(pickReleaseNote(NOTES, { ...old, version: '1.10.0' })).toBeNull()
  })

  it('молчит, если подтверждена версия новее (откат релиза)', () => {
    expect(pickReleaseNote(NOTES, { ...old, version: '1.11.0' })).toBeNull()
  })

  it('показывает следующую ноту тому, кто читал предыдущую', () => {
    expect(pickReleaseNote(NOTES, { ...old, version: '1.9.0' })?.action).toBe('show')
  })

  it('новичку окно не показывает, но отметку ставит — иначе оно всплывёт дважды на следующем релизе', () => {
    const fresh = { ...old, accountCreatedAt: '2026-09-11T10:00:00.000Z' }
    expect(pickReleaseNote(NOTES, fresh)).toEqual({ note: NOTES[1], action: 'acknowledge' })
  })

  it('без даты регистрации ведёт себя как со старым аккаунтом — окно важнее тишины', () => {
    expect(pickReleaseNote(NOTES, { ...old, accountCreatedAt: null })?.action).toBe('show')
  })
})
