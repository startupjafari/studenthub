import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { AppShell } from '../../widgets/app-shell'

// Оболочка роли platform-admin: доступ только PLATFORM_ADMIN (RoleGuard) + единый сайдбар/топбар.
export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <RoleGuard allow={[Role.PLATFORM_ADMIN]}>
      <AppShell locale={locale} variant="platform-admin">
        {children}
      </AppShell>
    </RoleGuard>
  )
}
