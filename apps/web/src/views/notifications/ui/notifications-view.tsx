'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  MessageSquare,
  Newspaper,
  type LucideIcon,
} from 'lucide-react'
import {
  deleteNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
  type NotificationItem,
  type NotificationType,
} from '../../../entities/notification'
import { useRealtimeEvent } from '../../../shared/realtime'
import { Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { NotificationMenu } from './notification-menu'

// Визуал по типу: иконка, цвет левого акцента и подложки иконки.
const TYPE_META: Record<NotificationType, { icon: LucideIcon; bar: string; iconWrap: string }> = {
  SCHEDULE_CHANGE: {
    icon: CalendarClock,
    bar: 'bg-indigo-500',
    iconWrap: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  },
  APP_UPDATE: {
    icon: FileText,
    bar: 'bg-amber-500',
    iconWrap: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  MESSAGE: {
    icon: MessageSquare,
    bar: 'bg-sky-500',
    iconWrap: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  POST: {
    icon: Newspaper,
    bar: 'bg-violet-500',
    iconWrap: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  EVENT: {
    icon: CalendarDays,
    bar: 'bg-emerald-500',
    iconWrap: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  SYSTEM: {
    icon: Bell,
    bar: 'bg-slate-400',
    iconWrap: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  },
}

// «Важные» — типы, напрямую затрагивающие студента (дедлайны/статусы). Чисто клиентский фильтр.
const IMPORTANT_TYPES = new Set<NotificationType>(['SCHEDULE_CHANGE', 'APP_UPDATE'])

type Filter = 'all' | 'unread' | 'important' | 'system'

// Панель уведомлений (оверлей сайдбара). Заполняет родителя; закрывается кнопкой «назад» (onClose).
// Основная область при этом остаётся на текущей странице — уведомления не отдельный роут.
export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Notifications')
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')

  const list = useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => fetchNotifications(50),
  })

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
    void qc.invalidateQueries({ queryKey: notificationKeys.list() })
  }

  useRealtimeEvent<{ notification: NotificationItem }>('notification:new', () => invalidate())

  const readMut = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate })
  const readAllMut = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate })
  const delMut = useMutation({ mutationFn: deleteNotification, onSuccess: invalidate })

  const items = useMemo(() => list.data ?? [], [list.data])
  const unread = items.filter((n) => !n.isRead).length
  const importantCount = items.filter((n) => IMPORTANT_TYPES.has(n.type)).length
  const systemCount = items.filter((n) => n.type === 'SYSTEM').length

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('filterAll'), count: items.length },
    { key: 'unread', label: t('filterUnread'), count: unread },
    { key: 'important', label: t('filterImportant'), count: importantCount },
    { key: 'system', label: t('filterSystem'), count: systemCount },
  ]

  const filtered = items.filter((n) => {
    if (filter === 'unread') return !n.isRead
    if (filter === 'important') return IMPORTANT_TYPES.has(n.type)
    if (filter === 'system') return n.type === 'SYSTEM'
    return true
  })

  // Группировка по дню: Сегодня / Вчера / дата. Элементы уже отсортированы сервером (createdAt desc).
  const groups = useMemo(() => {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const todayStart = startOfDay(new Date())
    const acc: { key: string; label: string; items: NotificationItem[] }[] = []
    for (const n of filtered) {
      const d = new Date(n.createdAt)
      const diff = Math.round((todayStart - startOfDay(d)) / 86_400_000)
      const g =
        diff === 0
          ? { key: 'today', label: t('today') }
          : diff === 1
            ? { key: 'yesterday', label: t('yesterday') }
            : {
                key: d.toDateString(),
                label: d.toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
              }
      let bucket = acc.find((x) => x.key === g.key)
      if (!bucket) {
        bucket = { key: g.key, label: g.label, items: [] }
        acc.push(bucket)
      }
      bucket.items.push(n)
    }
    return acc
  }, [filtered, locale, t])

  // Мини-стрелки прокрутки слайдера тегов: показываем при переполнении, гасим у краёв.
  const tabsRef = useRef<HTMLDivElement>(null)
  const [arrows, setArrows] = useState({ left: false, right: false })
  const syncArrows = useCallback(() => {
    const el = tabsRef.current
    if (!el) return
    setArrows({
      left: el.scrollLeft > 1,
      right: Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth,
    })
  }, [])
  useEffect(() => {
    syncArrows()
    const el = tabsRef.current
    if (!el) return
    el.addEventListener('scroll', syncArrows, { passive: true })
    window.addEventListener('resize', syncArrows)
    return () => {
      el.removeEventListener('scroll', syncArrows)
      window.removeEventListener('resize', syncArrows)
    }
  }, [syncArrows])
  // Пересчёт при изменении набора/счётчиков (меняется суммарная ширина тегов).
  useEffect(() => {
    syncArrows()
  }, [syncArrows, items.length, unread, importantCount, systemCount])
  const canScroll = arrows.left || arrows.right
  function scrollTabs(dir: 1 | -1): void {
    const el = tabsRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' })
  }

  function urlOf(n: NotificationItem): string | null {
    return typeof n.data?.url === 'string' ? n.data.url : null
  }

  // Клик по уведомлению: отмечаем прочитанным и, если есть ссылка, переходим по ней
  // (переход меняет роут → оверлей закрывается в app-shell).
  function onOpen(n: NotificationItem): void {
    if (!n.isRead) readMut.mutate(n.id)
    const url = urlOf(n)
    if (url) router.push(url)
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {/* Шапка: назад (слева) + «Уведомления» + «прочитать всё» (справа, иконка-кнопка). */}
      <div className="flex items-center gap-1.5 border-b border-border p-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('back')}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate text-lg font-bold">{t('title')}</span>
        <button
          type="button"
          aria-label={t('markAllRead')}
          title={t('markAllRead')}
          disabled={readAllMut.isPending || unread === 0}
          onClick={() => readAllMut.mutate()}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <CheckCheck className="size-5" aria-hidden />
        </button>
      </div>

      {/* Теги-фильтры слайдером + мини-стрелки по бокам (появляются при переполнении). */}
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-2">
        {canScroll && (
          <button
            type="button"
            aria-label={t('scrollLeft')}
            disabled={!arrows.left}
            onClick={() => scrollTabs(-1)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        )}
        <div
          ref={tabsRef}
          className="flex flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              aria-pressed={filter === tab.key}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                filter === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 tabular-nums',
                    filter === tab.key ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        {canScroll && (
          <button
            type="button"
            aria-label={t('scrollRight')}
            disabled={!arrows.right}
            onClick={() => scrollTabs(1)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.isLoading ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{t('emptyFilter')}</p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="flex flex-col">
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((n) => {
                const meta = TYPE_META[n.type]
                const Icon = meta.icon
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'group relative flex items-start gap-3 border-b border-border/50 px-3 py-2.5 transition-colors hover:bg-muted/50',
                      !n.isRead && 'bg-primary/[0.03]',
                    )}
                  >
                    <span className={cn('absolute inset-y-0 left-0 w-1', meta.bar)} aria-hidden />
                    <button
                      type="button"
                      onClick={() => onOpen(n)}
                      className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left"
                    >
                      <div
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-lg',
                          meta.iconWrap,
                        )}
                      >
                        <Icon className="size-5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {!n.isRead && (
                            <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {n.title}
                          </span>
                          <time className="shrink-0 text-[0.7rem] text-muted-foreground">
                            {formatTime(n.createdAt)}
                          </time>
                        </div>
                        {n.body && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {n.body}
                          </p>
                        )}
                      </div>
                    </button>
                    <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                      <NotificationMenu
                        isRead={n.isRead}
                        onMarkRead={() => readMut.mutate(n.id)}
                        onDelete={() => delMut.mutate(n.id)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
