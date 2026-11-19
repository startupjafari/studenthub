import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AuthSplitLayout } from '../../../shared/ui/auth-split-layout'
import { MessagesScope } from '../../../i18n/messages-scope'

/**
 * Публичные страницы работодателя (регистрация, подтверждение почты) — тот же
 * split-лейаут, что у входа и заявки вуза: слева брендовая панель, справа форма.
 *
 * Сессии здесь нет, поэтому ни RoleGuard, ни AppShell не подключаются. Текст панели свой:
 * у входа он обращается к студентам и преподавателям, а сюда приходит компания.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const t = useTranslations('Employer')
  const tAuth = useTranslations('Auth')

  return (
    <AuthSplitLayout
      title={t('brandSlogan')}
      subtitle={t('brandSubtitle')}
      copyright={tAuth('copyright')}
    >
      <MessagesScope scope="employer/(public)">{children}</MessagesScope>
    </AuthSplitLayout>
  )
}
