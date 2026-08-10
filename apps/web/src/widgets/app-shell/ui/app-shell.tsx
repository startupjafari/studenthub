'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, LogOut, MoreHorizontal, UserRound } from 'lucide-react'
import { AppSidebar } from './app-sidebar'
import { endSession } from '../../../shared/session'
import {
  NAV_BY_VARIANT,
  ROLE_TO_VARIANT,
  STUDENT_NAV,
  type NavItem,
  type NavVariant,
} from '../model/nav'
import { fetchMe, userKeys } from '../../../entities/user'
import { fetchUnreadCount, notificationKeys } from '../../../entities/notification'
import { useRealtimeEvent } from '../../../shared/realtime'
import { cn } from '../../../shared/lib/utils'
import { ChatLayoutProvider, useSheetDragClose } from '../../../shared/lib'
import { NotificationsPanel } from '../../../views/notifications'

function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/'
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

// Мобильная нижняя навигация (десктоп — сайдбар). 5 ячеек: первые 4 раздела роли + «Ещё».
// «Ещё» открывает нижний лист с уведомлениями, остальными разделами роли, профилем и выходом —
// так всё помещается, а Профиль (плашка сайдбара на десктопе) доступен и на телефоне.
function BottomNav({
  nav,
  notifOpen,
  onToggleNotif,
}: {
  nav: NavItem[]
  notifOpen: boolean
  onToggleNotif: () => void
}) {
  const pathname = usePathname()
  const tNav = useTranslations('Nav')
  const tShell = useTranslations('Dashboard')
  const queryClient = useQueryClient()
  const [moreOpen, setMoreOpen] = useState(false)
  // Свайп вниз закрывает лист «Ещё» — общий хук (touchmove не-passive + preventDefault, чтобы
  // жест не уходил в страницу/pull-to-refresh под листом).
  const sheetRef = useSheetDragClose<HTMLDivElement>(() => setMoreOpen(false))

  const unread = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: fetchUnreadCount,
  })
  // Живой бейдж: новое уведомление → пересчитать счётчик непрочитанных.
  useRealtimeEvent('notification:new', () => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
  })
  const count = unread.data ?? 0
  const badge = count > 99 ? '99+' : String(count)

  // Закрываем лист «Ещё» при любой навигации.
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  const overflow = nav.slice(4) // разделы роли, не влезшие в основные вкладки
  const profileActive = pathname === '/profile' || pathname.startsWith('/profile/')

  async function logout(): Promise<void> {
    await endSession()
    window.location.assign('/login')
  }

  const sheetItem =
    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted'

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
        {nav.slice(0, 4).map((item) => {
          const active = isActive(item, pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2 text-[0.625rem] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="w-full truncate text-center leading-tight">{tNav(item.key)}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1 px-0.5 py-2 text-[0.625rem] font-medium transition-colors',
            moreOpen ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <span className="relative shrink-0">
            <MoreHorizontal className="size-5" aria-hidden />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-2 flex min-w-[1.05rem] items-center justify-center rounded-full bg-primary px-1 text-[0.5625rem] font-bold text-primary-foreground">
                {badge}
              </span>
            )}
          </span>
          <span className="w-full truncate text-center leading-tight">{tNav('more')}</span>
        </button>
      </nav>

      {/* Нижний лист «Ещё»: уведомления + остальные разделы + профиль + выход. */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 bg-foreground/40 duration-150 animate-in fade-in lg:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            ref={sheetRef}
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-popover p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] duration-200 animate-in slide-in-from-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="mx-auto mt-1 mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30"
              aria-hidden
            />
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false)
                onToggleNotif()
              }}
              className={cn(sheetItem, notifOpen && 'text-primary')}
            >
              <span className="relative">
                <Bell className="size-5 shrink-0 opacity-80" aria-hidden />
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex min-w-[1.05rem] items-center justify-center rounded-full bg-primary px-1 text-[0.5625rem] font-bold text-primary-foreground">
                    {badge}
                  </span>
                )}
              </span>
              {tNav('notifications')}
            </button>
            {overflow.map((item) => {
              const Icon = item.icon
              const active = isActive(item, pathname)
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(sheetItem, active && 'text-primary')}
                >
                  <Icon className="size-5 shrink-0 opacity-80" aria-hidden />
                  {tNav(item.key)}
                </Link>
              )
            })}
            <Link
              href="/profile"
              onClick={() => setMoreOpen(false)}
              className={cn(sheetItem, profileActive && 'text-primary')}
            >
              <UserRound className="size-5 shrink-0 opacity-80" aria-hidden />
              {tNav('profile')}
            </Link>
            <button type="button" onClick={logout} className={cn(sheetItem, 'text-destructive')}>
              <LogOut className="size-5 shrink-0 opacity-80" aria-hidden />
              {tShell('logout')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function AppShell({
  locale,
  variant,
  children,
}: {
  locale: string
  variant: NavVariant
  children: ReactNode
}) {
  // Навигацию выбираем по РОЛИ пользователя (общие страницы вроде /profile сохраняют
  // сайдбар текущей роли). Проп variant — SSR-фолбэк до загрузки профиля.
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const effectiveVariant: NavVariant = me.data ? ROLE_TO_VARIANT[me.data.role] : variant
  const nav = NAV_BY_VARIANT[effectiveVariant] ?? STUDENT_NAV

  // На экране чатов сайдбар превращается в панель списка чатов (список порталится в слот).
  const pathname = usePathname()
  const chatsMode = pathname.endsWith('/chats')
  const [listSlot, setListSlot] = useState<HTMLElement | null>(null)

  // Уведомления — не отдельная страница, а оверлей поверх тела сайдбара: основная область
  // остаётся на текущей странице. Открывается пунктом «Уведомления», закрывается кнопкой «назад»
  // и при любой навигации на другую страницу.
  const [notifOpen, setNotifOpen] = useState(false)
  useEffect(() => {
    setNotifOpen(false)
  }, [pathname])

  // Открытый чат / оверлей уведомлений — полноэкранные поверхности на мобильном:
  // глобальную нижнюю навигацию прячем, чтобы она не перекрывала поле ввода / контент.
  const [chatOpen, setChatOpen] = useState(false)
  const hideBottomNav = chatOpen || notifOpen

  return (
    <ChatLayoutProvider value={{ listSlot, setChatOpen }}>
      <div className="fixed inset-0 flex h-dvh w-full overflow-hidden bg-muted/30">
        <AppSidebar
          nav={nav}
          locale={locale}
          listMode={chatsMode}
          onListSlot={setListSlot}
          notifOpen={notifOpen}
          onToggleNotif={() => setNotifOpen((o) => !o)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Мобильный header убран целиком (поиск по платформе удалён). Контент — сразу под ним. */}
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-24 md:p-6 md:pt-6 lg:pb-6">
            {children}
          </main>
        </div>
        {!hideBottomNav && (
          <BottomNav
            nav={nav}
            notifOpen={notifOpen}
            onToggleNotif={() => setNotifOpen((o) => !o)}
          />
        )}

        {/* Мобильный оверлей уведомлений — полноэкранный, как открытый чат (на десктопе он в сайдбаре).
            Занимает весь экран поверх нижней навигации; закрывается кнопкой «назад» панели. */}
        {notifOpen && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
            <NotificationsPanel onClose={() => setNotifOpen(false)} />
          </div>
        )}
      </div>
    </ChatLayoutProvider>
  )
}
