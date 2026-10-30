import { type Role, isRestrictedRole } from '@studenthub/shared-types'

/**
 * Есть ли у роли поиск по платформе. Охране и библиотекарю он закрыт на сервере
 * (RestrictedRoleGuard): люди, курсы и материалы вуза им не нужны. Кнопки поиска не
 * показываются, а палитра Ctrl+K остаётся списком быстрых действий — запрос в закрытый
 * эндпоинт не уходит.
 */
export function canSearch(role: Role | null | undefined): boolean {
  return !isRestrictedRole(role)
}
