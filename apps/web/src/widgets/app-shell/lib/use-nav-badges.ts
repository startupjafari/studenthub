'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Role } from '@studenthub/shared-types'
import { useChatsUnread } from '../../../entities/chat'
import { fetchUnreadCount, notificationKeys } from '../../../entities/notification'
import {
  applicationKeys,
  fetchQueueStats,
  useApplicationQueueRealtime,
} from '../../../entities/application-service'
import { fetchDemoRequests, onboardingKeys } from '../../../entities/onboarding'
import { useRealtimeEvent } from '../../../shared/realtime'
import { hasChats, type NavItem } from '../model/nav'

// Счётчики навигации — одним хуком на оболочку: сайдбар (десктоп) и нижняя навигация
// (телефон) показывают одни и те же числа. Раньше колокольчик сайдбара был без бейджа вовсе,
// а у заявок счётчика не было нигде — о новом узнавали, только открыв раздел.

/** Подающие заявки: им важно, что заявка вернулась на доработку или готова. */
const APPLICANT_ROLES = new Set<Role>([Role.STUDENT, Role.STAROSTA])
/** Разбирающие очередь: им важны новые поданные заявки. */
const QUEUE_ROLES = new Set<Role>([Role.DEAN, Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR])
/** Пункты навигации, которые ведут в заявки, — у разных ролей они называются по-разному. */
const APPLICATION_NAV_KEYS = ['applications', 'applicationsGroup', 'applicationsQueue']
/**
 * Заявки вузов приходят с публичной формы — события по сокету о них нет, поэтому счётчик
 * перечитывается раз в минуту (и при возврате во вкладку — по умолчанию React Query).
 */
const DEMO_REQUESTS_POLL_MS = 60_000
const NEW_DEMO_REQUESTS = { status: 'NEW', limit: 1 } as const

export interface NavBadges {
  /** Непрочитанные уведомления — на колокольчике. */
  notifications: number
  /** Число по ключу пункта навигации (`chats`, `applications`, `demoRequests`…). */
  byKey: Record<string, number>
}

export function useNavBadges(role: Role | undefined): NavBadges {
  const qc = useQueryClient()

  const notifications = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: fetchUnreadCount,
    enabled: !!role,
  })
  // Новое уведомление: пересчитать колокольчик. Смена статуса заявки студенту приходит
  // уведомлением же — заодно перечитываем и счётчик заявок.
  useRealtimeEvent('notification:new', () => {
    void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
    void qc.invalidateQueries({ queryKey: [...applicationKeys.all, 'queue-stats'] })
  })
  // Прочтение чата гасит его свёрнутую строку в колокольчике (§10.1), а отдельного события
  // об этом нет — без перечитывания бейдж висел до следующего уведомления.
  useRealtimeEvent('chat:read', () => {
    void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
  })

  const chats = useChatsUnread(role ? hasChats(role) : false)

  const applicant = !!role && APPLICANT_ROLES.has(role)
  const queue = !!role && QUEUE_ROLES.has(role)
  const stats = useQuery({
    queryKey: [...applicationKeys.all, 'queue-stats'],
    queryFn: fetchQueueStats,
    enabled: applicant || queue,
    staleTime: 30_000,
  })
  // Очередь сотрудника живая: подача, отзыв, смена статуса приходят событием по сокету.
  useApplicationQueueRealtime()
  const applications = stats.data
    ? applicant
      ? stats.data.actionNeeded + stats.data.ready
      : stats.data.new
    : 0

  const demo = useQuery({
    queryKey: onboardingKeys.demoRequests(NEW_DEMO_REQUESTS),
    queryFn: () => fetchDemoRequests(NEW_DEMO_REQUESTS),
    enabled: role === Role.PLATFORM_ADMIN,
    refetchInterval: DEMO_REQUESTS_POLL_MS,
  })

  const byKey: Record<string, number> = { chats }
  for (const key of APPLICATION_NAV_KEYS) byKey[key] = applications
  byKey.demoRequests = demo.data?.total ?? 0

  return { notifications: notifications.data ?? 0, byKey }
}

/** Число на пункте: своё, а у раздела без своего — сумма по его страницам. */
export function navBadgeOf(item: NavItem, byKey: Record<string, number>): number {
  const own = byKey[item.key] ?? 0
  if (own > 0) return own
  return item.children?.reduce((sum, child) => sum + (byKey[child.key] ?? 0), 0) ?? 0
}

/** Подпись числа на бейдже: больше 99 не читается в кружке. */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}
