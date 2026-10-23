import { Role } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Охват журналов поста охраны (docs/PROJECT.md §3.12): записи ведёт охрана, читают охрана
// и админ вуза — каждый только свой вуз. Роли закрыты и @Roles на маршрутах; здесь — вуз из
// JWT, а не из запроса (BACKEND_RULES §6.1).

/** Вуз, журнал которого ведёт охранник. */
export function recorderUniversity(actor: JwtPayload): string {
  if (actor.role !== Role.SECURITY_GUARD || !actor.universityId) {
    throw new AppException('FORBIDDEN', 'Журнал ведёт охрана вуза')
  }
  return actor.universityId
}

/** Вуз, журнал которого читает охрана или админ. */
export function journalUniversity(actor: JwtPayload): string {
  const canRead = actor.role === Role.SECURITY_GUARD || actor.role === Role.UNIVERSITY_ADMIN
  if (!canRead || !actor.universityId) {
    throw new AppException('FORBIDDEN', 'Журналы доступны охране и администратору вуза')
  }
  return actor.universityId
}
