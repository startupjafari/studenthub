import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { AppShell } from '../../widgets/app-shell'

// Оболочка охраны вуза: доступ только SECURITY_GUARD (RoleGuard) + единый сайдбар/топбар.
// Сканер, проверка студенческого и настройки — общие экраны группы (student); куда ещё
// охране можно, решает middleware (isSecurityGuardPath).
export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <RoleGuard allow={[Role.SECURITY_GUARD]}>
      <AppShell locale={locale} variant="security">
        {children}
      </AppShell>
    </RoleGuard>
  )
}
