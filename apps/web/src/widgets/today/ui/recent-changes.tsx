'use client'

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Bell, CalendarClock, CalendarDays, FileText, History, Newspaper } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { EmptyState, SectionPanel } from '../../../shared/ui'
import type { NotificationItem, NotificationType } from '../../../entities/notification'

// «Последние изменения» — только важные события (перенос пары, ответ по заявке,
// объявление, событие). Это НЕ копия страницы уведомлений: берём срез важных
// типов и ведём прямо к объекту через data.url.
const IMPORTANT: NotificationType[] = ['SCHEDULE_CHANGE', 'APP_UPDATE', 'EVENT', 'POST']

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  SCHEDULE_CHANGE: CalendarDays,
  APP_UPDATE: FileText,
  EVENT: CalendarClock,
  POST: Newspaper,
  MESSAGE: Bell,
  SYSTEM: Bell,
}

interface RecentChangesProps {
  notifications: NotificationItem[]
}

export function RecentChanges({ notifications }: RecentChangesProps) {
  const t = useTranslations('Today')
  const locale = useLocale()
  const router = useRouter()

  const items = notifications.filter((n) => IMPORTANT.includes(n.type)).slice(0, 5)

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <SectionPanel title={t('recentChanges')} subtitle={t('recentChangesHint')}>
      <>
        {items.length === 0 ? (
          <EmptyState
            icon={<History className="size-6" aria-hidden />}
            title={t('recentChangesEmpty')}
            className="border-0 p-6"
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((n) => {
              const Icon = TYPE_ICON[n.type]
              const url = typeof n.data?.url === 'string' ? n.data.url : null
              const clickable = url !== null
              return (
                <li key={n.id}>
                  <div
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => router.push(url) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              router.push(url)
                            }
                          }
                        : undefined
                    }
                    className={
                      'flex gap-3 rounded-lg p-2 text-left transition-colors' +
                      (clickable ? ' hover:bg-muted/50 focus-visible:bg-muted/50 outline-none' : '')
                    }
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatTime(n.createdAt)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </>
    </SectionPanel>
  )
}
