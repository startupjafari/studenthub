import { Role } from '@studenthub/shared-types'

/**
 * Есть ли у роли поиск по платформе. Охране он закрыт на сервере (SecurityRoleGuard):
 * люди, курсы и материалы вуза ей не нужны. Кнопки поиска не показываются, а палитра
 * Ctrl+K остаётся списком быстрых действий — запрос в закрытый эндпоинт не уходит.
 */
export function canSearch(role: Role | null | undefined): boolean {
  return role !== Role.SECURITY_GUARD
}
