import { SetMetadata } from '@nestjs/common'
import type { Role } from '@studenthub/shared-types'

export const RESTRICTED_ALLOWED_KEY = 'restrictedAllowed'

/**
 * Открывает маршрут ролям с запретом по умолчанию (`RESTRICTED_ROLES`: охрана,
 * библиотекарь; docs/PROJECT.md §2).
 *
 * Таким ролям открыт только явный список. Остальное RestrictedRoleGuard закрывает `403` — в
 * том числе эндпоинты без `@Roles`, которые по общему правилу открыты любому вошедшему, а в
 * сервисах отдают незнакомой роли данные уровня «весь вуз» (группы, расписание,
 * материалы). Запрет по умолчанию закрывает и маршруты, которых ещё нет.
 *
 * Роли перечисляются явно: `@RestrictedAllowed(Role.SECURITY_GUARD)` — только охране,
 * `@RestrictedAllowed(...RESTRICTED_ROLES)` — всем таким ролям (вход, свой аккаунт,
 * уведомления). Пометка ставится на обработчик или на весь контроллер; пометка обработчика
 * заменяет пометку контроллера. Что открыто роли, выясняется одним грепом по декоратору —
 * тем же приёмом, что `@MiniAllowed()`.
 */
export const RestrictedAllowed = (...roles: Role[]) => SetMetadata(RESTRICTED_ALLOWED_KEY, roles)
