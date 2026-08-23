'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AccountSettingsPanels } from '../../../widgets/account-settings'
import { PageHeader } from '../../../shared/ui'

// Страница /settings: шапка + панели настроек (те же, что во вкладке «Настройки» профиля).
export function SettingsView() {
  const tS = useTranslations('Settings')
  const router = useRouter()

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Возврат к профилю — кнопкой в самой шапке (как на других вложенных страницах):
          отдельная ссылка над шапкой мешала полосе встать вплотную к верху. */}
      <PageHeader
        title={tS('title')}
        subtitle={tS('subtitle')}
        onBack={() => router.push('/profile')}
        backLabel={tS('backToProfile')}
      />

      <AccountSettingsPanels />
    </div>
  )
}
