import { Role } from '@studenthub/shared-types'
import { resolveInviteTarget } from './invite-hierarchy'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function issuer(role: Role, scope: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'issuer',
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: scope.groupId ?? null,
  }
}

const platformAdmin = issuer(Role.PLATFORM_ADMIN)
const uniAdminA = issuer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' })
const deanA = issuer(Role.DEAN, { universityId: 'uni-A', facultyId: 'fac-A' })
const starostaA = issuer(Role.STAROSTA, {
  universityId: 'uni-A',
  facultyId: 'fac-A',
  groupId: 'grp-A',
})
const student = issuer(Role.STUDENT, {
  universityId: 'uni-A',
  facultyId: 'fac-A',
  groupId: 'grp-A',
})

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
    throw new Error('должно было бросить')
  } catch (err) {
    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).code).toBe(code)
  }
}

describe('resolveInviteTarget — матрица иерархии выдачи инвайтов (§2.1)', () => {
  describe('PLATFORM_MODERATOR', () => {
    it('PLATFORM_ADMIN выдаёт (глобальный scope)', () => {
      expect(resolveInviteTarget(platformAdmin, { role: Role.PLATFORM_MODERATOR })).toEqual({
        universityId: null,
        facultyId: null,
        groupId: null,
      })
    })
    it('UNIVERSITY_ADMIN не может', () => {
      expectCode(
        () => resolveInviteTarget(uniAdminA, { role: Role.PLATFORM_MODERATOR }),
        'FORBIDDEN',
      )
    })
  })

  describe('UNIVERSITY_ADMIN', () => {
    it('PLATFORM_ADMIN задаёт целевой университет', () => {
      expect(
        resolveInviteTarget(platformAdmin, { role: Role.UNIVERSITY_ADMIN, universityId: 'uni-X' }),
      ).toEqual({ universityId: 'uni-X', facultyId: null, groupId: null })
    })
    it('без universityId → BAD_REQUEST', () => {
      expectCode(
        () => resolveInviteTarget(platformAdmin, { role: Role.UNIVERSITY_ADMIN }),
        'BAD_REQUEST',
      )
    })
    it('UNIVERSITY_ADMIN не может выдать равную роль', () => {
      expectCode(
        () =>
          resolveInviteTarget(uniAdminA, { role: Role.UNIVERSITY_ADMIN, universityId: 'uni-A' }),
        'FORBIDDEN',
      )
    })
  })

  describe('DEAN', () => {
    it('UNIVERSITY_ADMIN выдаёт в своём университете', () => {
      expect(resolveInviteTarget(uniAdminA, { role: Role.DEAN, facultyId: 'fac-1' })).toEqual({
        universityId: 'uni-A',
        facultyId: 'fac-1',
        groupId: null,
      })
    })
    it('без facultyId → BAD_REQUEST', () => {
      expectCode(() => resolveInviteTarget(uniAdminA, { role: Role.DEAN }), 'BAD_REQUEST')
    })
    it('университет инвайта форсится из scope создателя (изоляция вузов)', () => {
      // Попытка указать чужой универ игнорируется — берётся uni-A создателя.
      expect(
        resolveInviteTarget(uniAdminA, {
          role: Role.DEAN,
          facultyId: 'fac-1',
          universityId: 'uni-OTHER',
        }),
      ).toEqual({ universityId: 'uni-A', facultyId: 'fac-1', groupId: null })
    })
    it('DEAN не может выдать DEAN', () => {
      expectCode(
        () => resolveInviteTarget(deanA, { role: Role.DEAN, facultyId: 'fac-A' }),
        'FORBIDDEN',
      )
    })
  })

  describe('TEACHER', () => {
    it('UNIVERSITY_ADMIN и DEAN могут', () => {
      expect(resolveInviteTarget(uniAdminA, { role: Role.TEACHER })).toMatchObject({
        universityId: 'uni-A',
      })
      expect(resolveInviteTarget(deanA, { role: Role.TEACHER })).toMatchObject({
        universityId: 'uni-A',
        facultyId: 'fac-A',
      })
    })
  })

  describe('STAROSTA', () => {
    it('DEAN выдаёт с группой', () => {
      expect(resolveInviteTarget(deanA, { role: Role.STAROSTA, groupId: 'grp-1' })).toEqual({
        universityId: 'uni-A',
        facultyId: 'fac-A',
        groupId: 'grp-1',
      })
    })
    it('без groupId → BAD_REQUEST', () => {
      expectCode(() => resolveInviteTarget(deanA, { role: Role.STAROSTA }), 'BAD_REQUEST')
    })
    it('UNIVERSITY_ADMIN не может выдать STAROSTA', () => {
      expectCode(
        () => resolveInviteTarget(uniAdminA, { role: Role.STAROSTA, groupId: 'grp-1' }),
        'FORBIDDEN',
      )
    })
  })

  describe('STUDENT', () => {
    it('DEAN выдаёт в любую группу своего факультета', () => {
      expect(resolveInviteTarget(deanA, { role: Role.STUDENT, groupId: 'grp-9' })).toMatchObject({
        universityId: 'uni-A',
        groupId: 'grp-9',
      })
    })
    it('STAROSTA выдаёт только в свою группу', () => {
      expect(resolveInviteTarget(starostaA, { role: Role.STUDENT })).toEqual({
        universityId: 'uni-A',
        facultyId: 'fac-A',
        groupId: 'grp-A',
      })
    })
    it('STAROSTA в чужую группу → WRONG_SCOPE', () => {
      expectCode(
        () => resolveInviteTarget(starostaA, { role: Role.STUDENT, groupId: 'grp-OTHER' }),
        'WRONG_SCOPE',
      )
    })
    it('STUDENT не может выдавать инвайты', () => {
      expectCode(
        () => resolveInviteTarget(student, { role: Role.STUDENT, groupId: 'grp-A' }),
        'FORBIDDEN',
      )
    })
  })
})
