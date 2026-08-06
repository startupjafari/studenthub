import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { AppShell } from '../../widgets/app-shell'

// Оболочка роли dean: доступ только DEAN (RoleGuard) + единый сайдбар/топбар.
export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <RoleGuard allow={[Role.DEAN]}>
      <AppShell locale={locale} variant="dean">
        {children}
      </AppShell>
    </RoleGuard>
  )
}
