import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { AppShell } from '../../widgets/app-shell'

// Оболочка библиотекаря вуза: доступ только LIBRARIAN (RoleGuard) + единый сайдбар/топбар.
// Сканер и настройки — общие экраны группы (student); куда ещё библиотекарю можно, решает
// middleware (isRestrictedRolePath).
export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <RoleGuard allow={[Role.LIBRARIAN]}>
      <AppShell locale={locale} variant="library">
        {children}
      </AppShell>
    </RoleGuard>
  )
}
