import { Role } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Охват модуля камер (docs/PROJECT.md §3.10): управляет только админ вуза, смотрят админ
// вуза и охрана — каждый только свой вуз. Платформа видео не видит. Роли закрыты и
// @Roles на маршрутах; здесь — вуз из JWT, а не из запроса (BACKEND_RULES §6.1).

/** Вуз, которым управляет админ. */
export function managedUniversity(actor: JwtPayload): string {
  if (actor.role !== Role.UNIVERSITY_ADMIN || !actor.universityId) {
    throw new AppException('FORBIDDEN', 'Камерами управляет администратор вуза')
  }
  return actor.universityId
}

/** Вуз, камеры которого смотрит админ или охрана. */
export function viewedUniversity(actor: JwtPayload): string {
  const canView = actor.role === Role.UNIVERSITY_ADMIN || actor.role === Role.SECURITY_GUARD
  if (!canView || !actor.universityId) {
    throw new AppException('FORBIDDEN', 'Камеры доступны охране и администратору вуза')
  }
  return actor.universityId
}
