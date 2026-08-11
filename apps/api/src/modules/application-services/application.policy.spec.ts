import { Role } from '@studenthub/shared-types'
import { ApplicationPolicy, type AppScopeFields } from './application.policy'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const policy = new ApplicationPolicy()

function viewer(role: Role, scope: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: 'u1', role, universityId: null, facultyId: null, groupId: null, ...scope }
}

const app: AppScopeFields = { studentId: 'stud', facultyId: 'fac', universityId: 'uni' }

describe('ApplicationPolicy — базовые права', () => {
  it('STAROSTA сохраняет права STUDENT (create/read:self/cancel:self)', () => {
    for (const a of ['create', 'read:self', 'cancel:self'] as const) {
      expect(policy.can(Role.STAROSTA, a)).toBe(true)
    }
    // но не обрабатывает и не видит чужие.
    expect(policy.can(Role.STAROSTA, 'process')).toBe(false)
    expect(policy.can(Role.STAROSTA, 'read:faculty')).toBe(false)
  })

  it('PLATFORM_ADMIN читает всё, но НЕ обрабатывает (матрица docs)', () => {
    expect(policy.can(Role.PLATFORM_ADMIN, 'read:all')).toBe(true)
    expect(policy.can(Role.PLATFORM_ADMIN, 'process')).toBe(false)
    expect(policy.can(Role.PLATFORM_ADMIN, 'manage-services')).toBe(true)
  })

  it('PLATFORM_MODERATOR и TEACHER — нет доступа к заявкам', () => {
    for (const role of [Role.PLATFORM_MODERATOR, Role.TEACHER]) {
      expect(policy.can(role, 'read:self')).toBe(false)
      expect(policy.can(role, 'process')).toBe(false)
    }
  })

  it('DEAN — факультетская обработка; UNIVERSITY_ADMIN — вузовская + manage-services', () => {
    expect(policy.can(Role.DEAN, 'read:faculty')).toBe(true)
    expect(policy.can(Role.DEAN, 'process')).toBe(true)
    expect(policy.can(Role.DEAN, 'manage-services')).toBe(false)
    expect(policy.can(Role.UNIVERSITY_ADMIN, 'read:university')).toBe(true)
    expect(policy.can(Role.UNIVERSITY_ADMIN, 'manage-services')).toBe(true)
  })
})

describe('ApplicationPolicy — scopeWhere', () => {
  it('read:all → пустой фильтр; студент → по себе; декан → по факультету; вуз-админ → по вузу', () => {
    expect(policy.scopeWhere(viewer(Role.PLATFORM_ADMIN))).toEqual({})
    expect(policy.scopeWhere(viewer(Role.STUDENT))).toEqual({ studentId: 'u1' })
    expect(policy.scopeWhere(viewer(Role.DEAN, { facultyId: 'fac' }))).toEqual({ facultyId: 'fac' })
    expect(policy.scopeWhere(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni' }))).toEqual({
      universityId: 'uni',
    })
  })

  it('нет read-прав (teacher) → заведомо пустой результат (защита от IDOR)', () => {
    expect(policy.scopeWhere(viewer(Role.TEACHER))).toEqual({ id: '__none__' })
  })
})

describe('ApplicationPolicy — canRead / canProcess', () => {
  it('студент видит только свою заявку', () => {
    expect(policy.canRead(viewer(Role.STUDENT, { sub: 'stud' }), app)).toBe(true)
    expect(policy.canRead(viewer(Role.STUDENT, { sub: 'other' }), app)).toBe(false)
  })

  it('декан обрабатывает свой факультет, но не чужой', () => {
    expect(policy.canProcess(viewer(Role.DEAN, { facultyId: 'fac' }), app)).toBe(true)
    expect(policy.canProcess(viewer(Role.DEAN, { facultyId: 'other' }), app)).toBe(false)
  })

  it('вуз-админ обрабатывает свой вуз; PLATFORM_ADMIN — не обрабатывает вовсе', () => {
    expect(policy.canProcess(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni' }), app)).toBe(
      true,
    )
    expect(policy.canProcess(viewer(Role.PLATFORM_ADMIN), app)).toBe(false)
  })

  it('assertCanRead бросает WRONG_SCOPE для чужой заявки', () => {
    expect(() => policy.assertCanRead(viewer(Role.STUDENT, { sub: 'other' }), app)).toThrow()
  })
})
