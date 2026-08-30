import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../../shared/session/role-guard'
import { AppShell } from '../../../widgets/app-shell'

// Зона работодателя: разделов платформы у него нет вовсе, только карьерный продукт.
// Публичные страницы (/employer/signup, /employer/verify) в эту оболочку не входят —
// у них свои layout'ы без RoleGuard.
export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <RoleGuard allow={[Role.EMPLOYER]}>
      <AppShell locale={locale} variant="employer">
        {children}
      </AppShell>
    </RoleGuard>
  )
}
