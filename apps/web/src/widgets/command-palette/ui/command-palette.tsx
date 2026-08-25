'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  CornerDownLeft,
  FolderOpen,
  MessagesSquare,
  Search,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { searchKeys, fetchSearch } from '../../../entities/search'
import { quickActionsFor } from '../model/quick-actions'

// Ширины строк скелетона: разной длины, иначе блок читается как таблица, а не как
// список названий. Значения же и служат ключами — индекс в key запрещён (§15).
const SKELETON_WIDTHS = ['42%', '61%', '35%', '54%', '47%']

interface Item {
  id: string
  navKey?: string // для быстрых действий — ключ i18n Nav
  label: string
  sub?: string
  href: string
  icon: LucideIcon
  section: string
}

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
  const [debounced, setDebounced] = useState('')
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
      setDebounced('')
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  const search = useQuery({
    queryKey: searchKeys.query(debounced),
    queryFn: () => fetchSearch(debounced),
    enabled: open && debounced.length >= 2,
    retry: false,
  })

  // «Ищем» начинается с ввода, а не с ухода запроса: между ними лежат 250 мс
  // дебаунса, и без этого флага список на них успевает мигнуть быстрыми
  // действиями — как будто набранный запрос сбросился.
  const typed = query.trim()
  const searching = typed.length >= 2 && (typed !== debounced || search.isFetching)
  // Уже показанные результаты при уточнении запроса не заменяем скелетоном: строки
  // просто обновятся. Скелетон — только когда показывать пока нечего.
  const hasResults = debounced.length >= 2 && !!search.data

  const items: Item[] = useMemo(() => {
    if (debounced.length >= 2) {
      const r = search.data
      if (!r) return []
      const out: Item[] = []
      for (const p of r.people)
        out.push({
          id: `p-${p.id}`,
          label: `${p.firstName} ${p.lastName}`,
          href: `/profile/${p.id}`,
          icon: UserRound,
          section: t('people'),
        })
      for (const c of r.courses)
        out.push({
          id: `c-${c.id}`,
          label: c.subject.name,
          sub: c.group.name,
          href: `/courses/${encodeURIComponent(c.subject.name)}`,
          icon: BookOpen,
          section: t('courses'),
        })
      for (const a of r.assignments)
        out.push({
          id: `a-${a.id}`,
          label: a.title,
          sub: a.course.subject.name,
          // Диплинк в конкретное задание (роут /assignments раскрывает деталь по ?open=).
          // Прежний '/assignments' не открывал найденное задание.
          href: `/assignments?open=${a.id}`,
          icon: ClipboardList,
          section: t('assignments'),
        })
      for (const m of r.materials)
        out.push({
          id: `m-${m.id}`,
          label: m.title,
          sub: m.subject ?? undefined,
          // Отдельного роута /materials нет (он 404-ил); материалы живут во вкладке
          // курса. Ведём в workspace дисциплины (роль-независимый роут), либо в список курсов.
          href: m.subject ? `/courses/${encodeURIComponent(m.subject)}` : '/courses',
          icon: FolderOpen,
          section: t('materials'),
        })
      for (const e of r.events)
        out.push({
          id: `e-${e.id}`,
          label: e.title,
          href: '/events',
          icon: CalendarDays,
          section: t('events'),
        })
      for (const ch of r.chats)
        out.push({
          id: `ch-${ch.id}`,
          label: ch.title ?? '',
          href: '/chats',
          icon: MessagesSquare,
          section: t('chats'),
        })
      return out
    }
    // Быстрые действия по роли.
    return quickActionsFor(role).map((qa) => ({
      id: `qa-${qa.navKey}`,
      navKey: qa.navKey,
      label: tNav(qa.navKey),
      href: qa.href,
      icon: qa.icon,
      section: t('actions'),
    }))
  }, [debounced, search.data, role, t, tNav])

  useEffect(() => {
    setActive(0)
  }, [items.length])

  function select(item: Item | undefined) {
    if (!item) return
    setOpen(false)
    router.push(item.href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
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
          className="fixed top-[8vh] left-1/2 z-[300] flex max-h-[80dvh] w-[80vw] max-w-[80vw] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('placeholder')}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
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
                {debounced.length >= 2 ? t('empty') : t('hint')}
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
                      onClick={() => select(item)}
                      onMouseEnter={() => setActive(i)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm outline-none',
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
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
