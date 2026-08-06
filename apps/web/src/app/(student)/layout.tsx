import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { AppShell, ROLE_TO_VARIANT, type NavVariant } from '../../widgets/app-shell'
import { getServerSession } from '../../shared/session/server'

// Общая оболочка для / (лента студента) и /profile (доступна всем ролям).
// SSR-фолбэк варианта навигации берём из роли сессии, чтобы сайдбар не мелькал
// студенческим при заходе не-студента в профиль; клиент затем подтверждает по /users/me.
export default async function StudentLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const session = await getServerSession()
  const variant: NavVariant = session ? ROLE_TO_VARIANT[session.role] : 'student'
  return (
    <AppShell locale={locale} variant={variant}>
      {children}
    </AppShell>
  )
}
