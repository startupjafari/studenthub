import { NAV_BY_VARIANT, type NavVariant } from '../../../widgets/app-shell'

/**
 * Раздел, который уже стоит в навигации роли, но своей страницы ещё не получил.
 *
 * Catch-all `[...section]` в зоне роли Next.js отдаёт, только когда точного маршрута нет,
 * поэтому сюда приходят два разных случая. Пункт меню, опередивший свой экран, — честная
 * заглушка «в разработке». Всё остальное — опечатка в адресе или ссылка на раздел, которого
 * больше нет, и это 404 (B-F26): иначе битые ссылки из навигации и писем не видны вовсе.
 */
export function isPlannedSection(variant: NavVariant, path: string): boolean {
  const normalized = path.replace(/\/+$/, '')
  return (NAV_BY_VARIANT[variant] ?? []).some((item) => item.href === normalized)
}
