import { Role, isHigherRole } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

export interface InviteScope {
  universityId: string | null
  facultyId: string | null
  groupId: string | null
}

export interface InviteRequest {
  role: Role
  universityId?: string | null
  facultyId?: string | null
  groupId?: string | null
}

// Кто может выдать инвайт на данную роль (docs/PROJECT.md §2.1).
// PLATFORM_ADMIN создаётся только seed-скриптом — его выдать нельзя.
export const ALLOWED_ISSUERS: Record<Role, Role[]> = {
  [Role.PLATFORM_ADMIN]: [],
  [Role.PLATFORM_MODERATOR]: [Role.PLATFORM_ADMIN],
  [Role.UNIVERSITY_ADMIN]: [Role.PLATFORM_ADMIN],
  [Role.UNIVERSITY_MODERATOR]: [Role.UNIVERSITY_ADMIN],
  [Role.DEAN]: [Role.UNIVERSITY_ADMIN],
  [Role.TEACHER]: [Role.UNIVERSITY_ADMIN, Role.DEAN],
  [Role.STAROSTA]: [Role.DEAN],
  [Role.STUDENT]: [Role.DEAN, Role.STAROSTA],
}

// Выводит фактический scope инвайта из иерархии и scope создателя.
// Бросает FORBIDDEN/WRONG_SCOPE/BAD_REQUEST. Cross-level membership
// (факультет ∈ вуз, группа ∈ факультет) проверяется в Ф5, когда появятся эти таблицы.
export function resolveInviteTarget(issuer: JwtPayload, input: InviteRequest): InviteScope {
  const allowed = ALLOWED_ISSUERS[input.role]
  if (!allowed.includes(issuer.role)) {
    throw new AppException(
      'FORBIDDEN',
      `Роль ${issuer.role} не может выдать инвайт на роль ${input.role}`,
    )
  }
  // Дублирующая проверка «строго ниже своей».
  if (!isHigherRole(issuer.role, input.role)) {
    throw new AppException('FORBIDDEN', 'Можно выдать только роль строго ниже своей')
  }

  switch (input.role) {
    case Role.PLATFORM_MODERATOR:
      return { universityId: null, facultyId: null, groupId: null }

    case Role.UNIVERSITY_ADMIN:
      // Платформенный админ задаёт целевой университет.
      return {
        universityId: req(input.universityId, 'universityId'),
        facultyId: null,
        groupId: null,
      }

    case Role.UNIVERSITY_MODERATOR:
      return { universityId: issuerUniversity(issuer), facultyId: null, groupId: null }

    case Role.DEAN:
      return {
        universityId: issuerUniversity(issuer),
        facultyId: req(input.facultyId, 'facultyId'),
        groupId: null,
      }

    case Role.TEACHER:
      return {
        universityId: issuerUniversity(issuer),
        facultyId: input.facultyId ?? issuer.facultyId ?? null,
        groupId: null,
      }

    case Role.STAROSTA:
    case Role.STUDENT: {
      const universityId = issuerUniversity(issuer)
      const groupId =
        issuer.role === Role.STAROSTA
          ? sameAsIssuer(input.groupId, issuer.groupId, 'groupId')
          : req(input.groupId, 'groupId')
      const facultyId = issuer.facultyId ?? input.facultyId ?? null
      return { universityId, facultyId, groupId }
    }

    default:
      throw new AppException('FORBIDDEN', 'Недопустимая роль инвайта')
  }
}

function req(value: string | null | undefined, field: string): string {
  if (!value) {
    throw new AppException('BAD_REQUEST', `Для этой роли обязателен ${field}`)
  }
  return value
}

function issuerUniversity(issuer: JwtPayload): string {
  if (!issuer.universityId) {
    throw new AppException('WRONG_SCOPE', 'У создателя нет университета в scope')
  }
  return issuer.universityId
}

function sameAsIssuer(
  input: string | null | undefined,
  issuerValue: string | null,
  field: string,
): string {
  if (!issuerValue) {
    throw new AppException('WRONG_SCOPE', `У создателя нет ${field} в scope`)
  }
  if (input && input !== issuerValue) {
    throw new AppException('WRONG_SCOPE', `${field} вне вашей области`)
  }
  return issuerValue
}
