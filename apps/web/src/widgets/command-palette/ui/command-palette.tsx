'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { CornerDownLeft, Search, X } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useSearchItems, type SearchItem } from '../../../entities/search'
import { quickActionsFor } from '../model/quick-actions'

// Ширины строк скелетона: разной длины, иначе блок читается как таблица, а не как
// список названий. Значения же и служат ключами — индекс в key запрещён (§15).
const SKELETON_WIDTHS = ['42%', '61%', '35%', '54%', '47%']

// Command Palette + глобальный поиск (задачи 22–23). Открытие: Ctrl/Cmd+K или событие
// `open-command-palette`. Быстрые действия зависят от роли; поиск — кросс-модульный по scope.
export function CommandPalette() {
  const role = useAppSelector((s) => s.auth.role)
  const authed = useAppSelector((s) => !!s.auth.accessToken)
  const t = useTranslations('Command')
  const tNav = useTranslations('Nav')
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Горячая клавиша + внешнее событие.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    function onOpen() {
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  // Дебаунс, запрос и разбор выдачи — в общем хуке поиска: палитра и поиск в нижней
  // навигации показывают одно и то же. Закрытая палитра ничего не запрашивает.
  const {
    items: results,
    active: searchActive,
    searching,
    hasResults,
  } = useSearchItems(open ? query : '')

  const items: SearchItem[] = useMemo(() => {
    if (searchActive) return results
    // Быстрые действия по роли — то, что показывается до ввода запроса.
    return quickActionsFor(role).map((qa) => ({
      id: `qa-${qa.navKey}`,
      label: tNav(qa.navKey),
      href: qa.href,
      icon: qa.icon,
      section: t('actions'),
    }))
  }, [searchActive, results, role, t, tNav])

  useEffect(() => {
    setActive(0)
  }, [items.length])

  // Стрелками список листается быстрее, чем прокручивается сам: без этого подсветка
  // уезжает за нижний край и пользователь жмёт Enter вслепую.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({
      block: 'nearest',
    })
  }, [active])

  function select(item: SearchItem | undefined) {
    if (!item) return
    setOpen(false)
    router.push(item.href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!items.length) return
    // По кругу: в длинном списке результатов упор в край заставляет искать глазами,
    // где остановилась подсветка. Так же ведут себя палитры Linear и VS Code.
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + items.length) % items.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(items.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(items[active])
    }
  }

  if (!authed || !role) return null

  let lastSection = ''

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[300] bg-overlay/30 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className={cn(
            'fixed z-[300] flex flex-col overflow-hidden bg-popover text-popover-foreground',
            // Телефон: во весь экран. Прежние 80vw посреди страницы с открытой клавиатурой
            // превращались в щель, а список результатов уезжал под клавиатуру.
            'inset-0 h-dvh w-full pt-[env(safe-area-inset-top)]',
            // Десктоп: панель сверху по центру. Ширина растёт по брейкпоинтам, но с потолком —
            // 80vw на широком мониторе растягивал строку результата через весь экран.
            'sm:inset-auto sm:top-[10vh] sm:left-1/2 sm:h-auto sm:max-h-[70dvh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-border sm:pt-0',
            'lg:max-w-4xl xl:max-w-5xl',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('placeholder')}
              // 16px на телефоне: при меньшем размере Safari зумит страницу на фокусе поля.
              className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:h-12 sm:text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('clear')}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
            {/* На телефоне Esc нажать нечем, а крестик в углу — мимо большого пальца. */}
            <DialogPrimitive.Close className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:hidden">
              {t('cancel')}
            </DialogPrimitive.Close>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto p-2">
            {searching && !hasResults ? (
              // Скелетон повторяет геометрию строки результата — иконка и название
              // на тех же местах, поэтому приход данных не сдвигает список.
              <ul aria-busy className="flex flex-col" aria-label={t('searching')}>
                {SKELETON_WIDTHS.map((width) => (
                  <li key={width} className="flex items-center gap-3 px-2.5 py-2">
                    <Skeleton className="size-4 shrink-0 rounded-md" />
                    <Skeleton className="h-3.5 rounded-md" style={{ width }} />
                  </li>
                ))}
              </ul>
            ) : items.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {searchActive ? t('empty') : t('hint')}
              </p>
            ) : (
              items.map((item, i) => {
                const showHeader = item.section !== lastSection
                lastSection = item.section
                return (
                  <div key={item.id}>
                    {showHeader && (
                      <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                        {item.section}
                      </div>
                    )}
                    <button
                      type="button"
                      data-idx={i}
                      onClick={() => select(item)}
                      onMouseEnter={() => setActive(i)}
                      className={cn(
                        // min-h-12 на телефоне: строка в 36 px — промах пальцем.
                        'flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm outline-none sm:min-h-0 sm:py-2',
                        i === active ? 'bg-muted' : 'hover:bg-muted/60',
                      )}
                    >
                      <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.sub && (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">
                          {item.sub}
                        </span>
                      )}
                      {i === active && (
                        <CornerDownLeft
                          className="hidden size-3.5 shrink-0 text-muted-foreground sm:block"
                          aria-hidden
                        />
                      )}
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Подсказка по клавишам: на телефоне клавиатуры нет, показывать нечего. */}
          <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex">
            <span className="flex items-center gap-1.5">
              <Key>↑</Key>
              <Key>↓</Key>
              {t('keyNavigate')}
            </span>
            <span className="flex items-center gap-1.5">
              <Key>↵</Key>
              {t('keyOpen')}
            </span>
            <span className="flex items-center gap-1.5">
              <Key>Esc</Key>
              {t('keyClose')}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// Клавиша в подсказке: символы (↑ ↵ Esc) не переводятся, поэтому лежат в разметке.
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[0.6875rem] text-muted-foreground">
      {children}
    </kbd>
  )
}
