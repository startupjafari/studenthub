import { Role } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Охват модуля библиотеки (docs/PROJECT.md §3.11): всё — в пределах вуза из JWT, а не из
// запроса (BACKEND_RULES §6.1). Роли закрыты и @Roles на маршрутах; здесь — вуз и отказ с
// понятным сообщением, если роль сюда всё-таки дошла.

/** Студент и староста — читатели: у обоих есть цифровой студенческий. */
export const READER_ROLES: readonly Role[] = [Role.STUDENT, Role.STAROSTA]

/** Кто ведёт фонд: библиотекарь и админ вуза (каталог, экземпляры, отчёты). */
export const LIBRARY_STAFF_ROLES: readonly Role[] = [Role.LIBRARIAN, Role.UNIVERSITY_ADMIN]

/** Кто видит каталог: читатели и те, кто ведёт фонд. */
export const LIBRARY_MEMBER_ROLES: readonly Role[] = [...READER_ROLES, ...LIBRARY_STAFF_ROLES]

function universityOf(actor: JwtPayload, allowed: readonly Role[], message: string): string {
  if (!allowed.includes(actor.role) || !actor.universityId) {
    throw new AppException('FORBIDDEN', message)
  }
  return actor.universityId
}

/** Вуз, правила библиотеки которого настраивает его админ. */
export function managedLibrary(actor: JwtPayload): string {
  return universityOf(actor, [Role.UNIVERSITY_ADMIN], 'Библиотеку настраивает администратор вуза')
}

/** Вуз, фонд которого ведёт библиотекарь или админ вуза. */
export function staffLibrary(actor: JwtPayload): string {
  return universityOf(actor, LIBRARY_STAFF_ROLES, 'Фонд ведут библиотекарь и администратор вуза')
}

/** Вуз, в библиотеке которого выдаёт и принимает книги библиотекарь. */
export function librarianLibrary(actor: JwtPayload): string {
  return universityOf(actor, [Role.LIBRARIAN], 'Книги выдаёт и принимает библиотекарь')
}

/** Вуз читателя — студента или старосты. */
export function readerLibrary(actor: JwtPayload): string {
  return universityOf(actor, READER_ROLES, 'Книги в библиотеке берут студенты и старосты')
}

/** Вуз, каталог которого виден: читателям и тем, кто ведёт фонд. */
export function memberLibrary(actor: JwtPayload): string {
  return universityOf(actor, LIBRARY_MEMBER_ROLES, 'Библиотека доступна студентам вуза')
}

/** Отказ «модуль/правило не позволяет» — 409 с полем, по которому клиент выберет текст. */
export function libraryConflict(field: string, message: string): AppException {
  return new AppException('CONFLICT', message, [{ field, message }])
}
