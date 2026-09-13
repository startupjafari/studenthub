import { Role } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/** Роли платформы: своего университета у них нет, область данных выбирается вручную. */
function isPlatformRole(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

/**
 * Университет, в чьём scope выполняется запрос карьерного центра — единая точка на все
 * разделы (допуск компаний, модерация вакансий, события, метрики).
 *
 * У сотрудника вуза он в токене, и подменить его параметром нельзя: явно переданный чужой
 * вуз — это WRONG_SCOPE, а не «уточнение». Платформенные роли своего вуза не имеют, и без
 * выбранного вуза этим разделам нечего показывать — им параметр обязателен. Раньше они
 * упирались в WRONG_SCOPE на каждом разделе карьерного центра, хотя навигация им эти
 * разделы показывала.
 *
 * Прав это никому не добавляет: платформенные роли и так видят данные любого вуза
 * (ScopeGuard), параметр лишь говорит, какой именно показать.
 */
export function resolveUniversityScope(viewer: JwtPayload, requested?: string): string {
  if (isPlatformRole(viewer.role)) {
    // Свой универ у платформенной роли тоже возможен (админ вуза, поднятый до платформы) —
    // тогда он и берётся по умолчанию, а параметр его переопределяет.
    const scope = requested ?? viewer.universityId
    if (!scope) throw new AppException('WRONG_SCOPE', 'Выберите университет')
    return scope
  }

  if (!viewer.universityId) {
    throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
  }
  if (requested && requested !== viewer.universityId) {
    throw new AppException('WRONG_SCOPE', 'Ресурс другого университета')
  }
  return viewer.universityId
}
