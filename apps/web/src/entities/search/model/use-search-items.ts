'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  FolderOpen,
  MessagesSquare,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { fetchSearch, searchKeys } from '../api/search-api'
import { searchHrefsFor } from './search-hrefs'

/** Короче двух символов не ищем: выдача по одной букве — это весь вуз. */
export const SEARCH_MIN_QUERY = 2
/** Пауза после последнего нажатия: запрос уходит один, а не на каждую букву. */
export const SEARCH_DEBOUNCE_MS = 250

export interface SearchItem {
  id: string
  label: string
  sub?: string
  href: string
  icon: LucideIcon
  section: string
}

export interface SearchItemsState {
  items: SearchItem[]
  /** Запрос набран и активен — значит показываем результаты, а не что было до поиска. */
  active: boolean
  /** Ищем: либо ждём дебаунс, либо запрос в полёте. */
  searching: boolean
  /** Есть что показать — скелетон уже не нужен. */
  hasResults: boolean
  error: boolean
  retry: () => void
}

/**
 * Глобальный поиск одним хуком: дебаунс ввода, запрос и результаты, уже разложенные
 * в плоский список строк «иконка · название · уточнение · ссылка».
 *
 * Один источник выдачи на весь продукт — палитра (Ctrl+K) и поиск в нижней навигации
 * показывают одно и то же одинаково разобранным.
 */
export function useSearchItems(query: string): SearchItemsState {
  const t = useTranslations('Command')
  const role = useAppSelector((s) => s.auth.role)
  const typed = query.trim()
  const [debounced, setDebounced] = useState('')

  // Очистка поля срабатывает без задержки: ждать 250 мс, чтобы убрать результаты,
  // незачем — дебаунс нужен только против лишних запросов.
  useEffect(() => {
    if (typed.length < SEARCH_MIN_QUERY) {
      setDebounced('')
      return
    }
    const id = setTimeout(() => setDebounced(typed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [typed])

  const active = debounced.length >= SEARCH_MIN_QUERY
  const search = useQuery({
    queryKey: searchKeys.query(debounced),
    queryFn: () => fetchSearch(debounced),
    enabled: active,
    retry: false,
  })

  const items: SearchItem[] = useMemo(() => {
    const r = active ? search.data : undefined
    if (!r) return []
    // Ссылки — экраны роли смотрящего (search-hrefs.ts); null — у роли такого экрана нет.
    const href = searchHrefsFor(role)
    const out: SearchItem[] = []
    for (const p of r.people)
      out.push({
        id: `p-${p.id}`,
        label: `${p.firstName} ${p.lastName}`,
        href: `/profile/${p.id}`,
        icon: UserRound,
        section: t('people'),
      })
    const { course, assignment, material } = href
    if (course)
      for (const c of r.courses)
        out.push({
          id: `c-${c.id}`,
          label: c.subject.name,
          sub: c.group.name,
          href: course(c.subject.name),
          icon: BookOpen,
          section: t('courses'),
        })
    if (assignment)
      for (const a of r.assignments)
        out.push({
          id: `a-${a.id}`,
          label: a.title,
          sub: a.course.subject.name,
          href: assignment(a.id),
          icon: ClipboardList,
          section: t('assignments'),
        })
    if (material)
      for (const m of r.materials)
        out.push({
          id: `m-${m.id}`,
          label: m.title,
          sub: m.subject ?? undefined,
          href: material(m.subject),
          icon: FolderOpen,
          section: t('materials'),
        })
    // Найденное открывается само, а не список раздела: событие — его страница, чат — сам чат.
    for (const e of r.events)
      out.push({
        id: `e-${e.id}`,
        label: e.title,
        href: href.event(e.id),
        icon: CalendarDays,
        section: t('events'),
      })
    for (const ch of r.chats)
      out.push({
        id: `ch-${ch.id}`,
        label: ch.title ?? '',
        href: href.chat(ch.id),
        icon: MessagesSquare,
        section: t('chats'),
      })
    return out
  }, [active, search.data, t, role])

  return {
    items,
    active,
    // «Ищем» начинается с ввода, а не с ухода запроса: между ними лежат 250 мс дебаунса,
    // и без этого флага список на них успевает мигнуть прежним содержимым.
    searching: typed.length >= SEARCH_MIN_QUERY && (typed !== debounced || search.isFetching),
    // Уже показанные результаты при уточнении запроса не заменяем скелетоном: строки
    // просто обновятся. Скелетон — только когда показывать пока нечего.
    hasResults: active && !!search.data,
    error: active && search.isError,
    retry: () => void search.refetch(),
  }
}
