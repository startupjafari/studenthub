'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, LogOut, MoreHorizontal, Search, UserRound, X } from 'lucide-react'
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
import { SEARCH_MIN_QUERY, useSearchItems } from '../../../entities/search'
import { Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ChatLayoutProvider } from '../../../shared/lib'
import { NotificationsPanel } from '../../../views/notifications'

// Ширины строк скелетона поиска: разной длины, иначе блок читается как таблица, а не как
// список названий. Значения же и служат ключами — индекс в key запрещён (§15).
const SEARCH_SKELETON_WIDTHS = ['52%', '38%', '61%']

function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/'
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

// Мобильная нижняя навигация (десктоп — сайдбар). 5 ячеек: первые 4 раздела роли + «Ещё».
// «Ещё» не открывает нижний лист во всю ширину: над навигацией всплывает второй остров того
// же материала (референс Telegram) — строки «иконка + подпись» с поиском, уведомлениями,
// остальными разделами роли, профилем и выходом. Сама кнопка на это время превращается в
// крестик: один элемент и открывает, и закрывает меню — палец не ищет вторую цель.
// Поиск — там же: он превращает капсулу разделов в поле ввода на всю её ширину, выдача
// приходит островом сверху, а крестик справа закрывает поиск.
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
  const tCommon = useTranslations('Common')
  const queryClient = useQueryClient()
  const [moreOpen, setMoreOpen] = useState(false)
  // Закрытие анимируем так же, как открытие: остров гаснет и оседает к своей кнопке, и
  // только потом размонтируется — иначе меню «пропадало» рывком.
  const [closing, setClosing] = useState(false)
  // Поиск живёт в самой навигации, отдельного экрана на телефоне у него нет: строка ввода
  // появляется там, где уже стоит палец, — у нижнего края. Палитра (Ctrl+K) осталась
  // десктопной, выдачу обе показывают одну и ту же (`useSearchItems`).
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    items: found,
    searching,
    hasResults,
    error: searchError,
    retry: retrySearch,
  } = useSearchItems(searchOpen ? query : '')

  const closeMore = useCallback(() => {
    setClosing(true)
    window.setTimeout(() => {
      setMoreOpen(false)
      setClosing(false)
    }, 200)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
  }, [])

  function openSearch(): void {
    // Меню и поиск делят место над навигацией: меню убираем сразу, без анимации закрытия,
    // иначе два острова на мгновение наложились бы друг на друга.
    setMoreOpen(false)
    setClosing(false)
    setSearchOpen(true)
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

  // Закрываем меню «Ещё» и поиск при любой навигации.
  useEffect(() => {
    setMoreOpen(false)
    setClosing(false)
    setSearchOpen(false)
    setQuery('')
  }, [pathname])

  // Escape закрывает то, что открыто: кнопка «Ещё» есть в табуляции, а в поле поиска
  // клавиатура уже под руками.
  useEffect(() => {
    if (!moreOpen && !searchOpen) return
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      if (searchOpen) closeSearch()
      else closeMore()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen, searchOpen, closeMore, closeSearch])

  const overflow = nav.slice(4) // разделы роли, не влезшие в основные вкладки
  // Ссылка ведёт на СВОЙ профиль (`/profile`), а `/profile/<id>` — это чужой. Со
  // `startsWith` открытый профиль другого пользователя подсвечивался так, будто читатель
  // стоит на своём: навигация указывала не туда, где он находится.
  const profileActive = pathname === '/profile'

  async function logout(): Promise<void> {
    await endSession()
    window.location.assign('/login')
  }

  // Строка меню-острова: иконка + подпись, высота 44 px — палец попадает без прицеливания.
  const menuRow =
    'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-foreground/[0.06] active:bg-foreground/[0.09]'
  // Счётчик — у правого края строки (референс Telegram), а не поверх иконки: в списке для
  // него есть место, и число не наезжает на подпись.
  const rowBadge =
    'ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-bold tabular-nums text-primary-foreground'
  const hairline = 'my-1 h-px bg-border/60'
  // Плавающий остров над навигацией: тот же материал и та же геометрия, что у капсулы
  // разделов, — меню и выдача поиска приходят в одно и то же место.
  const islandPanel =
    'material-island pointer-events-auto flex max-h-[min(70dvh,28rem)] flex-col overflow-y-auto overscroll-contain rounded-3xl border border-border/60 p-1.5 shadow-lg motion-reduce:animate-none'
  const typed = query.trim()
  // Крестик вместо точек — и для меню, и для поиска: кнопка всегда закрывает то, что открыто.
  const closeMode = moreOpen || searchOpen
  // Заголовок раздела выдачи печатается один раз на группу — список плоский, как в палитре.
  let lastSection = ''

  return (
    <>
      {/* Ловушка нажатий вне навигации: по z она ниже неё, поэтому острова остаются
          кликабельными, а тап по контенту закрывает меню или поиск. Затемнения нет — остров
          отделён от страницы материалом и тенью, как поповер, а не как модальный лист. */}
      {(moreOpen || searchOpen) && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          onClick={searchOpen ? closeSearch : closeMore}
        />
      )}

      {/* Навигация — плавающие острова, а не полоса во всю ширину: капсула с разделами
          (или поле поиска на её месте), отдельная круглая кнопка «Ещё» и её меню — таким же
          островом сверху. Полупрозрачный материал (apple-design §12) — контент виден под
          панелью и продолжает движение, нижний край экрана не отрезан. Плотный запасной
          вид — в .material-island.
          `bottom` и нижний отступ считаются с `--kb-inset`: на iOS клавиатура накрывает
          прибитую к низу панель, и поле поиска пришлось бы набирать вслепую. Там, где
          браузер ужал viewport сам (Android), переменная равна нулю и ничего не меняется. */}
      <nav className="pointer-events-none fixed inset-x-0 bottom-[var(--kb-inset,0px)] z-40 flex flex-col gap-2 px-3 pb-[max(0.5rem,calc(0.5rem+env(safe-area-inset-bottom)-var(--kb-inset,0px)))] lg:hidden">
        {/* Выдача поиска — островом над полем: набирает человек внизу, читает выше, как в
            любом мессенджере. До двух символов не показываем ничего — пустой остров
            подпрыгивал бы на каждой первой букве. */}
        {searchOpen && typed.length >= SEARCH_MIN_QUERY && (
          <div
            className={cn(
              islandPanel,
              // Потолок высоты — по месту, которое реально осталось над полем: с открытой
              // клавиатурой доля от высоты экрана (как у меню) срезала бы верх выдачи.
              'max-h-[min(28rem,calc(100dvh-var(--kb-inset,0px)-8rem))]',
              // Остров растёт из поля, а не из угла: открыл его именно ввод.
              'origin-bottom duration-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-1',
            )}
          >
            {searching && !hasResults ? (
              // Скелетон повторяет геометрию строки результата — иконка и название на тех
              // же местах, поэтому приход данных не сдвигает список.
              <ul aria-busy aria-label={tSearch('searching')} className="flex flex-col">
                {SEARCH_SKELETON_WIDTHS.map((width) => (
                  <li key={width} className="flex min-h-11 items-center gap-3 px-3">
                    <Skeleton className="size-5 shrink-0 rounded-md" />
                    <Skeleton className="h-3.5 rounded-md" style={{ width }} />
                  </li>
                ))}
              </ul>
            ) : searchError ? (
              <div className="flex flex-col items-center gap-1 px-3 py-5 text-center text-sm text-muted-foreground">
                {tCommon('error')}
                <button
                  type="button"
                  onClick={retrySearch}
                  className="cursor-pointer font-medium text-primary"
                >
                  {tCommon('retry')}
                </button>
              </div>
            ) : found.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                {tSearch('empty')}
              </p>
            ) : (
              found.map((item) => {
                const showHeader = item.section !== lastSection
                lastSection = item.section
                return (
                  <div key={item.id}>
                    {showHeader && (
                      <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                        {item.section}
                      </div>
                    )}
                    <Link href={item.href} onClick={closeSearch} className={menuRow}>
                      <item.icon className="size-5 shrink-0 opacity-80" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.sub && (
                        <span className="max-w-[45%] shrink-0 truncate text-xs font-normal text-muted-foreground">
                          {item.sub}
                        </span>
                      )}
                    </Link>
                  </div>
                )
              })
            )}
          </div>
        )}

        {moreOpen && (
          <div
            id="bottom-nav-more"
            className={cn(
              islandPanel,
              'ml-auto w-[min(17rem,100%)]',
              // Остров вырастает из кнопки «Ещё» — от её угла, а не из центра экрана: видно,
              // что именно он открыл.
              'origin-bottom-right',
              closing
                ? 'duration-200 animate-out fade-out zoom-out-95 slide-out-to-bottom-1 fill-mode-forwards'
                : 'duration-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-1',
            )}
          >
            {/* Поиск и уведомления — действия, а не разделы: первая группа. */}
            <button type="button" onClick={openSearch} className={menuRow}>
              <Search className="size-5 shrink-0 opacity-80" aria-hidden />
              {tNav('search')}
            </button>
            <button
              type="button"
              onClick={() => {
                closeMore()
                onToggleNotif()
              }}
              className={cn(menuRow, notifOpen && 'text-primary')}
            >
              <Bell className="size-5 shrink-0 opacity-80" aria-hidden />
              {tNav('notifications')}
              {count > 0 && <span className={rowBadge}>{badge}</span>}
            </button>

            {overflow.length > 0 && <div className={hairline} aria-hidden />}

            {/* Разделы роли, не влезшие в основные вкладки. */}
            {overflow.map((item) => {
              const Icon = item.icon
              const active = isActive(item, pathname)
              const badgeCount = item.key === 'chats' ? chatsUnread : 0
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(menuRow, active && 'bg-primary/10 text-primary')}
                >
                  <Icon className="size-5 shrink-0 opacity-80" aria-hidden />
                  <span className="min-w-0 truncate">{tNav(item.key)}</span>
                  {badgeCount > 0 && (
                    <span
                      aria-label={tNav('unreadMessages', { count: badgeCount })}
                      className={rowBadge}
                    >
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </Link>
              )
            })}

            <div className={hairline} aria-hidden />

            {/* Профиль и выход — не разделы роли, поэтому отбиты в последнюю группу. */}
            <Link
              href="/profile"
              onClick={() => setMoreOpen(false)}
              aria-current={profileActive ? 'page' : undefined}
              className={cn(menuRow, profileActive && 'bg-primary/10 text-primary')}
            >
              <UserRound className="size-5 shrink-0 opacity-80" aria-hidden />
              {tNav('profile')}
            </Link>
            <button type="button" onClick={logout} className={cn(menuRow, 'text-destructive')}>
              <LogOut className="size-5 shrink-0 opacity-80" aria-hidden />
              {tShell('logout')}
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {searchOpen ? (
            /* Поле занимает весь левый остров: во время поиска разделы не нужны, а ширина
               и высота остаются те же — раскладка не прыгает при открытии и закрытии. */
            <div className="material-island pointer-events-auto flex h-14 min-w-0 flex-1 items-center gap-2 rounded-full border border-border/60 px-4 shadow-lg transition-[border-color] focus-within:border-ring/70">
              <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={tSearch('placeholder')}
                placeholder={tNav('search')}
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                // 16 px: при меньшем размере Safari зумит страницу на фокусе поля.
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  aria-label={tSearch('clear')}
                  onClick={() => {
                    setQuery('')
                    // Фокус остаётся в поле: очистка — это продолжение набора, а не выход
                    // из поиска, и клавиатура не должна закрываться.
                    inputRef.current?.focus()
                  }}
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ) : (
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
                    <span className="w-full truncate text-center leading-tight">
                      {tNav(item.key)}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
          {/* «Ещё» — отдельный круглый остров: он открывает меню, а не переводит на раздел,
              и внутри капсулы разделов читался бы как пятая вкладка. Открытый поиск делает
              из него кнопку закрытия: искать и закрывать одной и той же целью. */}
          <button
            type="button"
            onClick={() => {
              if (searchOpen) closeSearch()
              else if (moreOpen) closeMore()
              else setMoreOpen(true)
            }}
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? 'bottom-nav-more' : undefined}
            aria-label={closeMode ? tCommon('close') : tNav('more')}
            className={cn(
              'material-island pointer-events-auto flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/60 shadow-lg transition-[color,transform] active:scale-95',
              closeMode ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span className="relative flex size-6 items-center justify-center">
              {/* Точки и крестик лежат друг на друге и перекрещиваются по прозрачности:
                  символ подменяется без «моргания», кнопка читается как один элемент в двух
                  состояниях. */}
              <MoreHorizontal
                className={cn(
                  'absolute size-6 transition-[opacity,transform] duration-150 motion-reduce:transition-none',
                  closeMode ? 'scale-75 opacity-0' : 'scale-100 opacity-100',
                )}
                aria-hidden
              />
              <X
                className={cn(
                  'absolute size-6 transition-[opacity,transform] duration-150 motion-reduce:transition-none',
                  closeMode ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
                )}
                aria-hidden
              />
              {/* Счётчик на кнопке нужен только пока она — «Ещё»: в режиме крестика число
                  ни при чём, а открытое меню само показывает его в строке «Уведомления». */}
              {count > 0 && !closeMode && (
                <span className="absolute -top-2 -right-2.5 flex min-w-[1.05rem] items-center justify-center rounded-full bg-primary px-1 text-[0.5625rem] font-bold text-primary-foreground">
                  {badge}
                </span>
              )}
            </span>
          </button>
        </div>
      </nav>
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
