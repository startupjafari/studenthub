'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  FileText,
  MessageSquare,
  Newspaper,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  fetchNotifications,
  notificationKeys,
  notificationCategory,
  isActionable,
  notificationUrl,
  notificationActionKey,
  useNotificationMutations,
  type NotificationItem,
  type NotificationType,
} from '../../../entities/notification'
import { useRealtimeEvent } from '../../../shared/realtime'
import {
  EmptyState,
  RowContextMenu,
  SegmentedTabs,
  Skeleton,
  type SegmentedTabItem,
} from '../../../shared/ui'
import { useSwipeRows } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

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

// Ширина одной кнопки свайп-панели строки (как в списке чатов).
const ROW_BTN_W = 72

// Центр активности: продуктовые категории поверх грубого NotificationType (docs/UNIFIED_UX.md PR-2).
// «action» — сводный фильтр «требует действия» (не категория, а срез по isActionable).
type Filter = 'all' | 'action' | 'study' | 'deanery' | 'social' | 'system'

// Панель уведомлений (оверлей сайдбара). Заполняет родителя; закрывается кнопкой «назад» (onClose).
// Основная область при этом остаётся на текущей странице — уведомления не отдельный роут.
export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Notifications')
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  // Открытое меню действий строки: id уведомления + точка нажатия. Одно на список —
  // по этому же id подсвечивается строка, к которой меню относится.
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // Свайп по строке (мобильный, как в списке чатов): вправо — «Прочитать», влево — «Удалить».
  // Физика жеста — общий хук shared/lib.
  const rows = useSwipeRows({ leftWidth: ROW_BTN_W, rightWidth: ROW_BTN_W })

  const list = useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () => fetchNotifications(50),
  })

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
    void qc.invalidateQueries({ queryKey: notificationKeys.list() })
  }

  useRealtimeEvent<{ notification: NotificationItem }>('notification:new', () => invalidate())

  // Оптимистичные мутации (общий хук, §5.5): мгновенно read/read-all/delete.
  const {
    readMutation: readMut,
    readAllMutation: readAllMut,
    deleteMutation: delMut,
  } = useNotificationMutations()

  const items = useMemo(() => list.data ?? [], [list.data])
  const unread = items.filter((n) => !n.isRead).length
  const menuItem = rowMenu ? items.find((n) => n.id === rowMenu.id) : undefined

  // Счётчики продуктовых категорий + «требует действия» (один проход).
  const counts = useMemo(() => {
    const c = { all: items.length, action: 0, study: 0, deanery: 0, social: 0, system: 0 }
    for (const n of items) {
      if (isActionable(n)) c.action += 1
      c[notificationCategory(n)] += 1
    }
    return c
  }, [items])

  const tabs: SegmentedTabItem<Filter>[] = [
    { value: 'all', label: t('filterAll'), count: counts.all },
    { value: 'action', label: t('filterActionNeeded'), count: counts.action },
    { value: 'study', label: t('filterStudy'), count: counts.study },
    { value: 'deanery', label: t('filterDeanery'), count: counts.deanery },
    { value: 'social', label: t('filterSocial'), count: counts.social },
    { value: 'system', label: t('filterSystem'), count: counts.system },
  ]

  const filtered = items.filter((n) => {
    if (filter === 'all') return true
    if (filter === 'action') return isActionable(n)
    return notificationCategory(n) === filter
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

  function openRowMenu(e: React.MouseEvent<HTMLElement>, id: string): void {
    e.preventDefault()
    e.stopPropagation()
    // Клавиша «контекстное меню» (и Shift+F10) шлёт то же событие с координатами 0,0 —
    // там меню оказалось бы в углу экрана, а не у строки. Берём её прямоугольник.
    const box = e.currentTarget.getBoundingClientRect()
    const keyboard = e.clientX === 0 && e.clientY === 0
    setRowMenu({
      id,
      x: keyboard ? box.left + 24 : e.clientX,
      y: keyboard ? box.bottom : e.clientY,
    })
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

      {/* Колонка, а не просто скролл-контейнер: состояния (скелетон, «нет уведомлений»)
          занимают всю высоту панели, а не жмутся полоской под фильтрами. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Фильтры — общий SegmentedTabs: у него и прокрутка ряда пальцем и мышью, и
            затухание у краёв, и сворачивание в селектор на узком экране. Свой ряд чипов
            был вдвое ниже цели нажатия (24 px против 44 px в §13) и на телефоне ловился
            с третьего раза.
            Ряд лежит внутри вертикального скролл-контейнера: при прокрутке списка уезжает
            вместе с ним, освобождая высоту на мобильном. */}
        <div className="shrink-0 border-b border-border bg-background px-2 py-1.5">
          <SegmentedTabs
            items={tabs}
            value={filter}
            onChange={setFilter}
            // Полоса над списком уведомлений — та же плотность, что у папок чатов.
            compact
            aria-label={t('filters')}
          />
        </div>

        {list.isLoading ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="min-h-14 w-full flex-1" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            className="m-3 border-none"
            icon={<Bell className="size-6" aria-hidden />}
            title={t('empty')}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            className="m-3 border-none"
            icon={<Bell className="size-6" aria-hidden />}
            title={t('emptyFilter')}
          />
        ) : (
          groups.map((group) => (
            // shrink-0: группы и строки — flex-элементы прокручиваемой колонки, а строка ещё и
            // overflow-hidden (панели свайпа), из-за чего теряет авто-минимум по контенту.
            <div key={group.key} className="flex shrink-0 flex-col">
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((n) => {
                const meta = TYPE_META[n.type]
                const Icon = meta.icon
                return (
                  <div
                    key={n.id}
                    onContextMenu={(e) => openRowMenu(e, n.id)}
                    className="relative shrink-0 overflow-hidden border-b border-border/50 lg:overflow-visible"
                  >
                    {/* Свайп ВПРАВО: «Прочитать» (мобильный) — та же раскладка, что у чатов. */}
                    <div className="absolute inset-y-0 left-0 z-0 flex lg:hidden">
                      <button
                        type="button"
                        aria-label={t('markRead')}
                        onClick={() => {
                          if (!n.isRead) readMut.mutate(n.id)
                          rows.closeRow(n.id)
                        }}
                        className="flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap bg-info px-1 text-center text-[0.6rem] font-medium leading-tight text-info-foreground"
                      >
                        <CheckCheck className="size-4" aria-hidden />
                        {t('markReadShort')}
                      </button>
                    </div>
                    {/* Свайп ВЛЕВО: «Удалить». */}
                    <div className="absolute inset-y-0 right-0 z-0 flex lg:hidden">
                      <button
                        type="button"
                        aria-label={t('delete')}
                        onClick={() => {
                          rows.closeRow(n.id)
                          delMut.mutate(n.id)
                        }}
                        className="flex w-[4.5rem] flex-col items-center justify-center gap-1 whitespace-nowrap bg-destructive px-1 text-center text-[0.6rem] font-medium leading-tight text-white"
                      >
                        <Trash2 className="size-4" aria-hidden />
                        {t('delete')}
                      </button>
                    </div>
                    {/* Сама строка — она и едет под пальцем; фон непрозрачный, иначе панели
                        просвечивают сквозь неё. */}
                    <div
                      ref={(el) => {
                        if (el) rows.rowElsRef.current.set(n.id, el)
                        else rows.rowElsRef.current.delete(n.id)
                      }}
                      onTouchStart={(e) => rows.onRowTouchStart(e, n.id)}
                      onTouchMove={rows.onRowTouchMove}
                      onTouchEnd={(e) => rows.onRowTouchEnd(e, n.id)}
                      className={cn(
                        'relative z-10 flex touch-pan-y items-start gap-3 bg-background px-3 py-2.5 transition-colors hover:bg-muted/50',
                        // Строка, над которой открыто меню, выделена всё время его жизни:
                        // список длинный, курсор уезжает к пунктам меню, и без метки
                        // непонятно, какое именно уведомление сейчас удаляют.
                        rowMenu?.id === n.id && 'bg-muted',
                      )}
                    >
                      {!n.isRead && (
                        <span
                          className="pointer-events-none absolute inset-0 bg-primary/[0.03]"
                          aria-hidden
                        />
                      )}
                      <span className={cn('absolute inset-y-0 left-0 w-1', meta.bar)} aria-hidden />
                      <button
                        type="button"
                        onClick={() => {
                          // Жест только что двигал строку — клик по ней не должен открывать
                          // уведомление; открытая панель по клику просто закрывается.
                          if (rows.swipedFlagRef.current) {
                            rows.swipedFlagRef.current = false
                            return
                          }
                          if (rows.swiped) {
                            rows.closeRow(rows.swiped.id)
                            return
                          }
                          onOpen(n)
                        }}
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
                              <span
                                className="size-2 shrink-0 rounded-full bg-primary"
                                aria-hidden
                              />
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
                          {/* Прямое действие уведомления (deep-link). Строку целиком открывает onOpen —
                            здесь только визуальный affordance с глаголом; выделяем, если требует действия. */}
                          {notificationUrl(n) && (
                            <span
                              className={cn(
                                'mt-1 inline-flex items-center gap-0.5 text-xs font-medium',
                                isActionable(n) ? 'text-primary' : 'text-muted-foreground',
                              )}
                            >
                              {t(notificationActionKey(n))}
                              <ChevronRight className="size-3.5" aria-hidden />
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {menuItem && rowMenu && (
        <RowContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          ariaLabel={t('actions')}
          onClose={() => setRowMenu(null)}
          items={[
            ...(menuItem.isRead
              ? []
              : [
                  {
                    key: 'markRead',
                    icon: CheckCheck,
                    label: t('markRead'),
                    onClick: () => readMut.mutate(menuItem.id),
                  },
                ]),
            {
              key: 'delete',
              icon: Trash2,
              label: t('delete'),
              onClick: () => delMut.mutate(menuItem.id),
              danger: true,
            },
          ]}
        />
      )}
    </div>
  )
}
