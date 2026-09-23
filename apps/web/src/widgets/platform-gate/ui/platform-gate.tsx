'use client'

import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { CircleSlash, Info, TriangleAlert, Wrench } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  usePlatformState,
  pickPlatformText,
  disabledSectionForPath,
} from '../../../entities/platform'
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
  const { maintenance, banner, disabledSections } = usePlatformState()
  const role = useAppSelector((s) => s.auth.role)
  const universityId = useAppSelector((s) => s.auth.universityId)
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations('Platform')

  const isStaff = role !== null && STAFF_ROLES.includes(role)

  // Назначенные на будущее работы платформу ещё не закрывают — о них предупреждают.
  if (maintenance?.active && !isStaff) {
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

  // Погашенный раздел закрыт для всех, включая платформенные роли. В отличие от техработ,
  // здесь нет требования «кто-то обязан суметь это снять»: снимается раздел из мини-аппа.
  // Зато есть обратное: решающий, вернуть ли раздел, должен видеть ту же платформу, что и
  // пользователи, — иначе он судит по экрану, которого никто больше не видит.
  if (disabledSectionForPath(pathname, disabledSections) !== null) {
    return (
      <StatusScreen
        icon={CircleSlash}
        title={t('sectionOffTitle')}
        description={t('sectionOffText')}
      />
    )
  }

  return (
    <>
      {maintenance && (isStaff || !maintenance.active) && (
        <Notice level="WARNING" icon={TriangleAlert}>
          {maintenance.active
            ? t('maintenanceStaffNotice', { until: formatUntil(maintenance.until, locale) })
            : t('maintenancePlanned', {
                from: formatUntil(maintenance.startsAt ?? maintenance.until, locale),
                until: formatUntil(maintenance.until, locale),
              })}
        </Notice>
      )}
      {banner && forAudience(banner, role, universityId) && (
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

/**
 * Предназначено ли объявление этому человеку. Пустой прицел — всем.
 *
 * Роль и вуз проверяются независимо: «преподавателям такого-то вуза» — это пересечение,
 * а не объединение, иначе объявление для одного вуза долетело бы до преподавателей всех.
 */
function forAudience(
  banner: { roles: string[]; universityIds: string[] },
  role: Role | null,
  universityId: string | null,
): boolean {
  if (banner.roles.length > 0 && (role === null || !banner.roles.includes(role))) return false
  if (
    banner.universityIds.length > 0 &&
    (universityId === null || !banner.universityIds.includes(universityId))
  ) {
    return false
  }
  return true
}
