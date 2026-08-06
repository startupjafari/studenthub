import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../../shared/session/role-guard'
import { AppShell } from '../../../widgets/app-shell'

// Оболочка роли university-moderator: доступ только UNIVERSITY_MODERATOR (RoleGuard) + единый сайдбар/топбар.
export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <RoleGuard allow={[Role.UNIVERSITY_MODERATOR]}>
      <AppShell locale={locale} variant="university-moderator">
        {children}
      </AppShell>
    </RoleGuard>
  )
}
