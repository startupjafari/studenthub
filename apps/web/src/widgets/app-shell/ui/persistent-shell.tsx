'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useAppSelector } from '../../../shared/store'
import { isShellPath } from '../model/shell-paths'
import { ROLE_TO_VARIANT, type NavVariant } from '../model/nav'

// Оболочка — отдельным чанком (задача 21.B4). Она тянет панель уведомлений, поиск,
// согласия и счётчики, а вход, юридические страницы и публичные ссылки рисуются без неё:
// статический импорт отдавал этот код каждой странице. SSR остаётся (ssr по умолчанию):
// на страницах с оболочкой чанк попадает в предзагрузку HTML, мигания нет.
const AppShell = dynamic(() => import('./app-shell').then((m) => m.AppShell))

/**
 * Оболочка, общая для всех ролевых зон. Стоит в корневом layout, поэтому при навигации
 * не размонтируется никогда: меняется только область контента.
 *
 * Ролевые layout'ы остались — они проверяют роль (RoleGuard), но оболочку больше не
 * рисуют. Вариант навигации от зоны и раньше не зависел: он выводится из роли (у каждой
 * зоны — ровно её роль), а AppShell уточняет его по профилю.
 *
 * `usePathname` в клиентском компоненте отдаёт путь и при серверной отрисовке, так что
 * решение «с оболочкой или без» одно и то же на сервере и на клиенте — без расхождения
 * гидрации и без кадра «страница без сайдбара».
 */
export function PersistentShell({
  locale,
  variant,
  children,
}: {
  locale: string
  /** Вариант из role-cookie на момент серверной отрисовки корневого layout. */
  variant: NavVariant
  children: ReactNode
}) {
  const pathname = usePathname()
  // Роль сессии из стора сильнее варианта с сервера. Корневой layout при клиентских
  // переходах не перерисовывается: отрисованный на /login (сессии ещё нет — «студент»), он
  // так и отдавал бы этот вариант, и преподаватель после входа до прихода профиля видел бы
  // студенческое меню. Вход записывает роль в стор до перехода (establishSession). При
  // серверной отрисовке и гидрации стор пуст — работает вариант из cookie, без расхождения.
  const role = useAppSelector((s) => s.auth.role)
  if (!isShellPath(pathname)) return <>{children}</>
  return (
    <AppShell locale={locale} variant={role ? ROLE_TO_VARIANT[role] : variant}>
      {children}
    </AppShell>
  )
}
