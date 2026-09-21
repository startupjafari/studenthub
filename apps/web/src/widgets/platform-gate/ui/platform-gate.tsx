'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Info, TriangleAlert, Wrench } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { usePlatformState, pickPlatformText } from '../../../entities/platform'
import { useAppSelector } from '../../../shared/store'
import { StatusScreen } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Оболочка, через которую состояние платформы доходит до человека: заглушка техработ и
// баннер-объявление.
//
// Почему обёртка, а не блок внутри страницы: техработы обязаны накрыть приложение целиком,
// включая страницу логина. Человек, который не может войти, должен прочитать причину, а не
// биться в форму, которая всё равно не пустит.
//
// Платформенные роли заглушку не видят: они и есть те, кто чинит. Но баннер им показывается
// — иначе включивший режим забудет, что он включён, и обнаружит это по чужому звонку.
// Это удобство, а не защита: доступ к данным во время техработ закрывает сервер.

const STAFF_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

export function PlatformGate({ children }: { children: React.ReactNode }) {
  const { maintenance, banner } = usePlatformState()
  const role = useAppSelector((s) => s.auth.role)
  const locale = useLocale()
  const t = useTranslations('Platform')

  const isStaff = role !== null && STAFF_ROLES.includes(role)

  if (maintenance && !isStaff) {
    return (
      <StatusScreen
        icon={Wrench}
        title={t('maintenanceTitle')}
        description={
          maintenance.message
            ? pickPlatformText(maintenance.message, locale)
            : t('maintenanceFallback')
        }
        // Возвращаться некуда: во время техработ любой маршрут покажет тот же экран.
        showHome={false}
        detail={{ label: t('maintenanceUntil'), value: formatUntil(maintenance.until, locale) }}
      />
    )
  }

  return (
    <>
      {maintenance && isStaff && (
        <Notice level="WARNING" icon={TriangleAlert}>
          {t('maintenanceStaffNotice', { until: formatUntil(maintenance.until, locale) })}
        </Notice>
      )}
      {banner && (
        <Notice level={banner.level} icon={banner.level === 'WARNING' ? TriangleAlert : Info}>
          {pickPlatformText(banner.text, locale)}
        </Notice>
      )}
      {children}
    </>
  )
}

/** Полоса объявления над приложением: в потоке, а не поверх, — она не должна ничего закрывать. */
function Notice({
  level,
  icon: Icon,
  children,
}: {
  level: 'INFO' | 'WARNING'
  icon: typeof Info
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 px-4 py-2 text-center text-sm',
        level === 'WARNING'
          ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
          : 'bg-primary/10 text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

/** Только время, если конец сегодня; иначе дата со временем — «до 14:30» без дня врёт. */
function formatUntil(iso: string, locale: string): string {
  const until = new Date(iso)
  const sameDay = until.toDateString() === new Date().toDateString()
  return until.toLocaleString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
  })
}
