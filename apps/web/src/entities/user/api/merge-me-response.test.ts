import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import type { MeResponse } from '../../../shared/api'
import { mergeMeResponse } from './user-api'

const base: MeResponse = {
  id: 'u1',
  email: 'dean@uni.kz',
  firstName: 'Айгерим',
  lastName: 'Садыкова',
  avatarUrl: null,
  role: Role.DEAN,
  showEmail: false,
  universityId: 'un1',
  facultyId: 'f1',
  groupId: null,
}

const eds = {
  iinLast4: '1234',
  subjectCn: 'САДЫКОВА АЙГЕРИМ',
  orgBin: null,
  certNotAfter: '2027-03-12T00:00:00.000Z',
  linkedAt: '2026-11-01T00:00:00.000Z',
  lastUsedAt: null,
}

// PATCH /users/me и загрузка аватара отдают карточку без `eds`: привязка ЭЦП не должна
// «пропадать» из настроек после правки профиля.
describe('mergeMeResponse', () => {
  it('ответ без eds сохраняет прежнюю привязку', () => {
    const next = { ...base, firstName: 'Айгерім' }
    expect(mergeMeResponse(next)({ ...base, eds })).toEqual({ ...next, eds })
  })

  it('ответ с eds (GET /users/me) — источник истины, в том числе null после отвязки', () => {
    expect(mergeMeResponse({ ...base, eds: null })({ ...base, eds })).toEqual({
      ...base,
      eds: null,
    })
  })

  it('кэша ещё нет — кладётся ответ как есть', () => {
    expect(mergeMeResponse(base)(undefined)).toBe(base)
  })
})
