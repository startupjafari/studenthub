'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { NavLink } from './nav-link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Bell, ChevronDown, LogOut, ScanQrCode, Search, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from '../../../shared/ui'
import { fetchMe, userKeys } from '../../../entities/user'
import { useChatsUnread } from '../../../entities/chat'
import { canSearch } from '../../../entities/search'
import { endSession } from '../../../shared/session'
import { cn } from '../../../shared/lib/utils'
import { NotificationsPanel } from '../../../views/notifications'
import { ROLE_HOME } from '../../../shared/config'
import { ProductSwitcher } from './product-switcher'
import {
  careerHomeFor,
  hasCareerProduct,
  hasChats,
  isNavHrefActive,
  isNavItemActive,
} from '../model/nav'
import type { NavItem } from '../model/nav'

// Разбивает навигацию на секции по item.group. Секции — в порядке первого появления группы,
// элементы одной группы собираются вместе (даже если разнесены в списке — напр. «Документы»,
// добавляемые в конец, попадают в свою секцию, а не создают дубль заголовка). Заголовки
// показываем, только если групп ≥2 (иначе список плоский — как раньше, для остальных ролей).
const UNGROUPED = '__ungrouped__'

function toSections(nav: NavItem[]): { group?: string; items: NavItem[] }[] {
  const distinct = new Set(nav.map((i) => i.group).filter(Boolean))
  if (distinct.size < 2) return [{ items: nav }]
  const order: string[] = []
  const byGroup = new Map<string, NavItem[]>()
  for (const item of nav) {
    const key = item.group ?? UNGROUPED
    if (!byGroup.has(key)) {
      byGroup.set(key, [])
      order.push(key)
    }
    byGroup.get(key)!.push(item)
  }
  return order.map((key) => ({
    group: key === UNGROUPED ? undefined : key,
    items: byGroup.get(key)!,
  }))
}

/**
 * Раздел со своими страницами: строка раздела раскрывает список страниц под собой. Пока
 * открыта одна из страниц, раздел раскрыт сам — человек видит, где он и что рядом. Свернуть
 * можно и тогда: это его сайдбар, а не навязанное состояние.
 */
function NavSection({ item, pathname }: { item: NavItem; pathname: string }) {
  const tNav = useTranslations('Nav')
  const active = isNavItemActive(item, pathname)
  const [open, setOpen] = useState(active)
  // Перешли в раздел откуда-то ещё (палитра, ссылка на странице) — раскрываем его.
  useEffect(() => {
    if (active) setOpen(true)
  }, [active])
  const Icon = item.icon
  const listId = `nav-section-${item.key}`

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{tNav(item.key)}</span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {/* Линия слева — под центром иконки раздела: страницы читаются как его ветка. */}
      {open && (
        <ul id={listId} className="ml-5 flex flex-col gap-0.5 border-l border-border pl-3">
          {item.children?.map((child) => {
            const childActive = isNavHrefActive(child.href, pathname, child.exact)
            return (
              <li key={child.href}>
                <NavLink
                  href={child.href}
                  aria-current={childActive ? 'page' : undefined}
                  className={cn(
                    'flex rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    childActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className="min-w-0 truncate">{tNav(child.key)}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function initials(first?: string, last?: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '·'
}

export function AppSidebar({
  nav,
  listMode = false,
  onListSlot,
  notifOpen = false,
  onToggleNotif,
}: {
  nav: NavItem[]
  locale: string
  // На экране чатов тело сайдбара — слот, куда виджет чатов порталит список.
  listMode?: boolean
  onListSlot?: (el: HTMLElement | null) => void
  // Уведомления — оверлей поверх тела сайдбара (не роут).
  notifOpen?: boolean
  onToggleNotif?: () => void
}) {
  const pathname = usePathname()
  const tNav = useTranslations('Nav')
  const tRoles = useTranslations('Roles')
  const tShell = useTranslations('Dashboard')
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  // Пока роль неизвестна, бейдж не запрашиваем: охране чатов не положено, и её запрос
  // ушёл бы в 403 на каждом экране.
  const chatsUnread = useChatsUnread(me.data ? hasChats(me.data.role) : false)

  async function logout() {
    await endSession()
    window.location.assign('/login')
  }

  // Плашка ведёт на СВОЙ профиль (`/profile`), а `/profile/<id>` — это чужой. Со
  // `startsWith` открытый профиль другого пользователя подсвечивал плашку так, будто
  // читатель стоит на своём: раздел в навигации указывал не туда, где он находится.
  const profileActive = pathname === '/profile'

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
      {notifOpen ? (
        // Оверлей уведомлений: список поверх тела сайдбара; основная область не меняется.
        <NotificationsPanel onClose={() => onToggleNotif?.()} />
      ) : listMode ? (
        // Слот: виджет чатов порталит сюда весь список вместе с заголовком.
        <div ref={onListSlot} className="flex min-h-0 flex-1 flex-col" />
      ) : (
        <>
          <div className="flex h-16 items-center gap-2 px-6">
            {/* Логотип — он же переключатель продуктов (учёба / Карьера), раскрывается
                по наведению. Отдельного пункта в навигации у Карьеры нет. */}
            <ProductSwitcher
              homeHref={me.data ? ROLE_HOME[me.data.role] : '/'}
              careerHref={hasCareerProduct(me.data?.role) ? careerHomeFor(me.data?.role) : null}
            />
            {/* Поиск (Command Palette) — Ctrl/Cmd+K или клик. У охраны поиска нет. */}
            {canSearch(me.data?.role) && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
                aria-label={tNav('search')}
                title={tNav('search')}
                className="ml-auto flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
              >
                <Search className="size-5" aria-hidden />
              </button>
            )}
            {/* Колокол уведомлений справа от логотипа — открывает оверлей списка. Без поиска
                (охрана) к правому краю его прижимает сам колокол. */}
            <button
              type="button"
              onClick={() => onToggleNotif?.()}
              aria-label={tNav('notifications')}
              title={tNav('notifications')}
              aria-pressed={notifOpen}
              className={cn(
                'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors active:scale-90',
                !canSearch(me.data?.role) && 'ml-auto',
                notifOpen
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Bell className="size-5" aria-hidden />
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
            {toSections(nav).map((section, si) => (
              <div key={section.group ?? `s${si}`} className="flex flex-col gap-1">
                {section.group && (
                  <p className="px-3 pb-0.5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {tNav(`group.${section.group}`)}
                  </p>
                )}
                {section.items.map((item) => {
                  if (item.children) {
                    return <NavSection key={item.key} item={item} pathname={pathname} />
                  }
                  const Icon = item.icon
                  const active = isNavItemActive(item, pathname)
                  return (
                    <NavLink
                      key={item.key}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{tNav(item.key)}</span>
                      {item.key === 'chats' && chatsUnread > 0 && (
                        <span
                          aria-label={tNav('unreadMessages', { count: chatsUnread })}
                          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[0.65rem] font-bold tabular-nums text-primary-foreground"
                        >
                          {chatsUnread > 99 ? '99+' : chatsUnread}
                        </span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            ))}
          </nav>
        </>
      )}

      {/* Плашка профиля — вплотную под разделяющей линией, без внешних отступов. */}
      <div className="border-t border-border">
        <div
          className={cn(
            'flex items-center gap-3 px-4 py-3 transition-colors',
            profileActive ? 'bg-primary/10' : 'hover:bg-muted',
          )}
        >
          {/* Пока профиля нет — плейсхолдеры. Условие не только по `isLoading`: запрос `me`
              выключен, пока нет access-токена (восстановление сессии), и в этот момент
              `isLoading` уже false, а данных ещё нет. Раньше туда попадала вторая ветка
              и рисовала «·» из пустых инициалов и «—» вместо имени — выглядело как сбой. */}
          {me.isLoading || !me.data ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-3"
              aria-busy
              aria-label={tShell('loading')}
            >
              {/* Аватар-заглушка — иконка пользователя: она сразу говорит, чьё это место,
                  в отличие от пульсирующего круга или одинокой точки. */}
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UserRound className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ) : (
            <NavLink
              href="/profile"
              aria-current={profileActive ? 'page' : undefined}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <Avatar className="size-9">
                {me.data.avatarUrl && <AvatarImage src={me.data.avatarUrl} alt="" />}
                <AvatarFallback>{initials(me.data.firstName, me.data.lastName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {me.data.firstName} {me.data.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground">{tRoles(me.data.role)}</p>
              </div>
            </NavLink>
          )}
          {/* Единый сканер QR StudentHub: вход на другом устройстве, студенческий, отметка. */}
          <Link
            href="/scan"
            aria-label={tNav('scan')}
            title={tNav('scan')}
            aria-current={pathname === '/scan' ? 'page' : undefined}
            className={cn(
              'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors',
              pathname === '/scan'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <ScanQrCode className="size-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={logout}
            aria-label={tShell('logout')}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  )
}
