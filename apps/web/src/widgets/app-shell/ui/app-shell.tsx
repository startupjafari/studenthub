'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, LogOut, MoreHorizontal, Search, UserRound } from 'lucide-react'
import { AppSidebar } from './app-sidebar'
import { endSession } from '../../../shared/session'
import {
  NAV_BY_VARIANT,
  ROLE_TO_VARIANT,
  STUDENT_NAV,
  careerNavFor,
  isCareerPath,
  type NavItem,
  type NavVariant,
} from '../model/nav'
import { fetchMe, userKeys } from '../../../entities/user'
import { fetchUnreadCount, notificationKeys } from '../../../entities/notification'
import { useRealtimeEvent } from '../../../shared/realtime'
import { useChatsUnread } from '../../../entities/chat'
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
  const chatsUnread = useChatsUnread()
  const tShell = useTranslations('Dashboard')
  const tSearch = useTranslations('Command')
  const queryClient = useQueryClient()
  const [moreOpen, setMoreOpen] = useState(false)
  // Закрытие по крестику/фону тоже анимируем: лист уезжает вниз, фон гаснет, и только
  // потом размонтируется — иначе шторка «пропадала» рывком, а свайп закрывался плавно.
  const [closing, setClosing] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  // Свайп вниз закрывает лист «Ещё» — общий хук (touchmove не-passive + preventDefault, чтобы
  // жест не уходил в страницу/pull-to-refresh под листом). Фон гаснет вместе с листом.
  const sheetRef = useSheetDragClose<HTMLDivElement>(() => setMoreOpen(false), { backdropRef })

  function closeMore(): void {
    setClosing(true)
    window.setTimeout(() => {
      setMoreOpen(false)
      setClosing(false)
    }, 200)
  }

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
    setClosing(false)
  }, [pathname])

  const overflow = nav.slice(4) // разделы роли, не влезшие в основные вкладки
  // Ссылка ведёт на СВОЙ профиль (`/profile`), а `/profile/<id>` — это чужой. Со
  // `startsWith` открытый профиль другого пользователя подсвечивался так, будто читатель
  // стоит на своём: навигация указывала не туда, где он находится.
  const profileActive = pathname === '/profile'

  async function logout(): Promise<void> {
    await endSession()
    window.location.assign('/login')
  }

  // Ряд-действие в шторке: высота ≥48 px — палец попадает без прицеливания.
  const sheetRow =
    'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors hover:bg-muted active:bg-muted'
  // Плитка раздела: крупная цель (~80 px) вместо строки списка в 40 px.
  const sheetTile =
    'flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl px-1.5 py-3 text-center text-xs font-medium transition-colors hover:bg-muted active:bg-muted'

  return (
    <>
      {/* Навигация — плавающие острова, а не полоса во всю ширину: капсула с разделами и
          отдельная круглая кнопка «Ещё». Полупрозрачный материал (apple-design §12) — контент
          виден под панелью и продолжает движение, нижний край экрана не отрезан. Плотный
          запасной вид — в .material-island. */}
      <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end gap-2 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden">
        <div className="material-island pointer-events-auto flex min-w-0 flex-1 items-stretch gap-0.5 rounded-full border border-border/60 p-1 shadow-lg">
          {nav.slice(0, 4).map((item) => {
            const active = isActive(item, pathname)
            const Icon = item.icon
            const badgeCount = item.key === 'chats' ? chatsUnread : 0
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1 text-[0.625rem] font-medium transition-colors',
                  // Активный раздел — залитая пилюля внутри капсулы: на полупрозрачном
                  // материале одного цвета текста мало, чтобы прочитать «я здесь».
                  active ? 'bg-foreground/[0.08] text-primary' : 'text-muted-foreground',
                )}
              >
                {/* Бейдж навешен на иконку, а не на строку: в нижней навигации подпись и так
                  обрезается по ширине вкладки, и число рядом с ней было бы нечитаемо. */}
                <span className="relative shrink-0">
                  <Icon className="size-5" aria-hidden />
                  {badgeCount > 0 && (
                    <span
                      aria-label={tNav('unreadMessages', { count: badgeCount })}
                      className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-bold tabular-nums text-primary-foreground"
                    >
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-center leading-tight">{tNav(item.key)}</span>
              </Link>
            )
          })}
        </div>
        {/* «Ещё» — отдельный круглый остров: он открывает лист, а не переводит на раздел,
            и внутри капсулы разделов читался бы как пятая вкладка. */}
        <button
          type="button"
          onClick={() => (moreOpen ? closeMore() : setMoreOpen(true))}
          aria-expanded={moreOpen}
          aria-label={tNav('more')}
          className={cn(
            'material-island pointer-events-auto flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/60 shadow-lg transition-[color,transform] active:scale-95',
            moreOpen ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <span className="relative">
            <MoreHorizontal className="size-6" aria-hidden />
            {count > 0 && (
              <span className="absolute -top-2 -right-2.5 flex min-w-[1.05rem] items-center justify-center rounded-full bg-primary px-1 text-[0.5625rem] font-bold text-primary-foreground">
                {badge}
              </span>
            )}
          </span>
        </button>
      </nav>

      {/* Нижний лист «Ещё»: быстрые действия, разделы роли плитками, профиль и выход.
          Плитки вместо списка: цель ~80 px против строки в 40 px, и весь набор виден без
          прокрутки у большинства ролей. */}
      {moreOpen && (
        <div
          ref={backdropRef}
          className={cn(
            'fixed inset-0 z-50 bg-overlay/50 lg:hidden',
            closing ? 'duration-200 animate-out fade-out' : 'duration-150 animate-in fade-in',
          )}
          onClick={closeMore}
        >
          <div
            ref={sheetRef}
            className={cn(
              'absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-popover pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
              closing
                ? 'duration-200 animate-out slide-out-to-bottom fill-mode-forwards'
                : 'duration-200 animate-in slide-in-from-bottom',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Зона захвата шторки: сама полоска маленькая, но тянуть можно за всю шапку. */}
            <div className="sticky top-0 z-10 bg-popover pt-2 pb-1" aria-hidden>
              <div className="mx-auto h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Поиск — первым и во всю ширину: он же строка ввода, к которой тянется рука,
                и по нему промахнуться нельзя. Уведомления идут отдельной строкой ниже. */}
            <div className="flex flex-col gap-2 px-3 pb-2">
              <button
                type="button"
                onClick={() => {
                  closeMore()
                  window.dispatchEvent(new Event('open-command-palette'))
                }}
                className={cn(
                  sheetRow,
                  'border border-border bg-muted/40 font-normal text-muted-foreground',
                )}
              >
                <Search className="size-5 shrink-0 opacity-80" aria-hidden />
                {tSearch('placeholder')}
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMore()
                  onToggleNotif()
                }}
                className={cn(sheetRow, 'border border-border', notifOpen && 'text-primary')}
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
            </div>

            {/* Разделы роли, не влезшие в нижние вкладки. */}
            <div className="grid grid-cols-3 gap-2 px-3 pb-2">
              {overflow.map((item) => {
                const Icon = item.icon
                const active = isActive(item, pathname)
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(sheetTile, active && 'bg-primary/10 text-primary')}
                  >
                    <Icon className="size-6 shrink-0 opacity-80" aria-hidden />
                    <span className="line-clamp-2 leading-tight">{tNav(item.key)}</span>
                  </Link>
                )
              })}
            </div>

            {/* Профиль и выход — отдельной секцией: это не разделы роли. */}
            <div className="mt-1 grid grid-cols-2 gap-2 border-t border-border px-3 pt-3">
              <Link
                href="/profile"
                onClick={() => setMoreOpen(false)}
                className={cn(
                  sheetRow,
                  'justify-center border border-border',
                  profileActive && 'text-primary',
                )}
              >
                <UserRound className="size-5 shrink-0 opacity-80" aria-hidden />
                {tNav('profile')}
              </Link>
              <button
                type="button"
                onClick={logout}
                className={cn(sheetRow, 'justify-center border border-border text-destructive')}
              >
                <LogOut className="size-5 shrink-0 opacity-80" aria-hidden />
                {tShell('logout')}
              </button>
            </div>
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

  // На экране чатов сайдбар превращается в панель списка чатов (список порталится в слот).
  const pathname = usePathname()

  // Карьера — отдельный продукт: под /career сайдбар показывает её разделы, а не разделы
  // платформы. Обратно — через переключатель под логотипом.
  const nav = isCareerPath(pathname)
    ? careerNavFor(me.data?.role)
    : (NAV_BY_VARIANT[effectiveVariant] ?? STUDENT_NAV)
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
      <div className="fixed inset-0 flex h-[calc(100dvh-var(--kb-inset,0px))] w-full overflow-hidden bg-muted/30">
        <AppSidebar
          nav={nav}
          locale={locale}
          listMode={chatsMode}
          onListSlot={setListSlot}
          notifOpen={notifOpen}
          onToggleNotif={() => setNotifOpen((o) => !o)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Мобильный header убран целиком (поиск по платформе удалён). Контент — сразу под ним.
              `flex flex-col` — чтобы страница могла занять всю свободную высоту (`flex-1` у
              обёртки): так работают экраны с таблицей во всю высоту. Обычные страницы от этого
              не меняются — блок с авто-высотой в колонке ведёт себя как раньше. */}
          {/* `sh-scroll` резервирует место под полосу прокрутки: без этого переход с короткой
              страницы на длинную сдвигал всю раскладку на ширину полосы. */}
          <main className="sh-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-28 md:p-6 md:pt-6 md:pb-28 lg:pb-6">
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
