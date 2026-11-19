import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AuthSplitLayout } from '../../shared/ui/auth-split-layout'
import { MessagesScope } from '../../i18n/messages-scope'

// Split-лейаут экранов входа/регистрации: слева интерактивная брендовая панель
// (меш-сетка за мышью, скрыта на мобильном), справа — форма. Страница не прокручивается,
// длинная форма регистрации — внутри правой колонки (AuthSplitLayout).
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('Auth')

  return (
    <AuthSplitLayout
      title={t('brandSlogan')}
      subtitle={t('brandSubtitle')}
      copyright={t('copyright')}
    >
      <MessagesScope scope="(auth)">{children}</MessagesScope>
    </AuthSplitLayout>
  )
}
