'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { isShellPath } from '../model/shell-paths'
import type { NavVariant } from '../model/nav'
import { AppShell } from './app-shell'

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
  variant: NavVariant
  children: ReactNode
}) {
  const pathname = usePathname()
  if (!isShellPath(pathname)) return <>{children}</>
  return (
    <AppShell locale={locale} variant={variant}>
      {children}
    </AppShell>
  )
}
