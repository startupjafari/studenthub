'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { AccountSettingsPanels } from '../../../widgets/account-settings'

// Страница /settings: шапка + панели настроек (те же, что во вкладке «Настройки» профиля).
export function SettingsView() {
  const tS = useTranslations('Settings')

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/profile"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {tS('backToProfile')}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{tS('title')}</h1>
        <p className="text-sm text-muted-foreground">{tS('subtitle')}</p>
      </div>

      <AccountSettingsPanels />
    </div>
  )
}
