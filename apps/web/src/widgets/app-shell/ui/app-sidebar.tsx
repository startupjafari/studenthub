'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Bell, GraduationCap, LogOut, Search } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from '../../../shared/ui'
import { fetchMe, userKeys } from '../../../entities/user'
import { endSession } from '../../../shared/session'
import { cn } from '../../../shared/lib/utils'
import { NotificationsPanel } from '../../../views/notifications'
import type { NavItem } from '../model/nav'

function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/'
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

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

  async function logout() {
    await endSession()
    window.location.assign('/login')
  }

  const profileActive = pathname === '/profile' || pathname.startsWith('/profile/')

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
            <GraduationCap className="size-6 text-primary" aria-hidden />
            <span className="text-lg font-bold">StudentHub</span>
            {/* Поиск (Command Palette) — Ctrl/Cmd+K или клик. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
              aria-label={tNav('search')}
              title={tNav('search')}
              className="ml-auto flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
            >
              <Search className="size-5" aria-hidden />
            </button>
            {/* Колокол уведомлений справа от логотипа — открывает оверлей списка. */}
            <button
              type="button"
              onClick={() => onToggleNotif?.()}
              aria-label={tNav('notifications')}
              title={tNav('notifications')}
              aria-pressed={notifOpen}
              className={cn(
                'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors active:scale-90',
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
                  const Icon = item.icon
                  const active = isActive(item, pathname)
                  return (
                    <Link
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
                      {tNav(item.key)}
                    </Link>
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
          {me.isLoading ? (
            // Понятный индикатор загрузки профиля: пульсирующие плейсхолдеры вместо «—».
            <div
              className="flex min-w-0 flex-1 items-center gap-3"
              aria-busy
              aria-label={tShell('loading')}
            >
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ) : (
            <Link
              href="/profile"
              aria-current={profileActive ? 'page' : undefined}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <Avatar className="size-9">
                {me.data?.avatarUrl && <AvatarImage src={me.data.avatarUrl} alt="" />}
                <AvatarFallback>{initials(me.data?.firstName, me.data?.lastName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {me.data ? `${me.data.firstName} ${me.data.lastName}` : '—'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {me.data ? tRoles(me.data.role) : ''}
                </p>
              </div>
            </Link>
          )}
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
