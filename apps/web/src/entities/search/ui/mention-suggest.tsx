'use client'

import { useEffect, useImperativeHandle, useState, type RefObject } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { SearchSource } from '@studenthub/shared-schemas'
import { fetchSearch, searchKeys } from '../api/search-api'
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY } from '../model/use-search-items'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/** Незакрытое упоминание перед курсором: «@iva» → «iva». Иначе null. */
export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const m = /(^|[^\w@])@([a-zA-Z0-9._-]{0,32})$/.exec(before)
  return m ? (m[2] ?? '') : null
}

/** Заменяет набранное упоминание готовым логином и возвращает текст и позицию курсора. */
export function applyMention(
  text: string,
  caret: number,
  login: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf('@')
  const next = `${text.slice(0, start)}@${login} ${text.slice(caret)}`
  return { text: next, caret: start + login.length + 2 }
}

// Упоминанию нужны только люди: остальные пять источников поиска сервер не трогает.
const MENTION_SOURCES: readonly SearchSource[] = ['people']

/**
 * Клавиатура подсказки: поле ввода отдаёт ей клавишу первой. `true` — клавиша обработана
 * (стрелки двигают выбор, Enter и Tab подставляют, Esc прячет список) и полю её делать
 * не нужно: иначе Enter при открытом списке отправлял комментарий вместо выбора человека.
 */
export interface MentionSuggestHandle {
  handleKey: (key: string) => boolean
}

/**
 * Подсказка упоминаний под полем ввода.
 *
 * Ищет через общий `/search`, который уже ограничен вузом зрителя, — отдельного
 * «поиска для упоминаний» заводить не пришлось. Логин показываем рядом с именем:
 * в комментарий уедет именно он, и человек должен видеть, что выбирает.
 *
 * Запрос — по тем же правилам, что глобальный поиск: от двух символов (короче сервер
 * отвечает 422, а прежний повтор при ошибке удваивал запросы) и после паузы в наборе,
 * а не на каждую букву.
 */
export function MentionSuggest({
  query,
  onPick,
  handle,
  className,
}: {
  query: string | null
  onPick: (login: string) => void
  handle?: RefObject<MentionSuggestHandle | null>
  /** Положение списка — по умолчанию над полем, у левого края. */
  className?: string
}) {
  const t = useTranslations('Feed')
  const [active, setActive] = useState(0)
  // Esc прячет список до следующей правки упоминания, а не навсегда.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const typed = query ?? ''
  const [debounced, setDebounced] = useState('')

  // Закрытое или слишком короткое упоминание гасит подсказку сразу — ждать паузу, чтобы
  // убрать список, незачем.
  useEffect(() => {
    if (typed.length < SEARCH_MIN_QUERY) {
      setDebounced('')
      return
    }
    const id = setTimeout(() => setDebounced(typed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [typed])

  const enabled =
    query !== null && query.length >= SEARCH_MIN_QUERY && debounced.length >= SEARCH_MIN_QUERY

  const results = useQuery({
    queryKey: searchKeys.query(debounced, MENTION_SOURCES),
    queryFn: () => fetchSearch(debounced, MENTION_SOURCES),
    enabled,
    retry: false,
    // Уточнение «@iv» → «@iva» не мигает пустотой: прежний список виден, пока идёт новый.
    placeholderData: keepPreviousData,
  })

  // Люди без логина упоминанию не подлежат: подставлять было бы нечего.
  const people = (results.data?.people ?? []).filter((p) => p.username).slice(0, 6)

  useEffect(() => setActive(0), [query])

  const open = enabled && people.length > 0 && dismissed !== query

  useImperativeHandle(
    handle,
    () => ({
      handleKey(key) {
        if (!open) return false
        if (key === 'ArrowDown') setActive((i) => (i + 1) % people.length)
        else if (key === 'ArrowUp') setActive((i) => (i - 1 + people.length) % people.length)
        else if (key === 'Enter' || key === 'Tab') {
          const person = people[Math.min(active, people.length - 1)]
          if (person?.username) onPick(person.username)
        } else if (key === 'Escape') setDismissed(query)
        else return false
        return true
      },
    }),
    [open, people, active, onPick, query],
  )

  if (!open) return null

  return (
    <ul
      role="listbox"
      aria-label={t('mentionHint')}
      className={cn(
        'absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg',
        className,
      )}
    >
      {people.map((p, i) => (
        <li key={p.id}>
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            // mousedown, а не click: click срабатывает после blur поля, и к этому
            // моменту позиция курсора уже потеряна.
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(p.username as string)
            }}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
              i === active ? 'bg-muted' : 'hover:bg-muted',
            )}
          >
            <Avatar className="size-7 shrink-0">
              {p.avatarUrl && <AvatarImage src={p.avatarUrl} alt="" />}
              <AvatarFallback className="text-[10px]">
                {`${p.lastName[0] ?? ''}${p.firstName[0] ?? ''}`.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate">
              {p.lastName} {p.firstName}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">@{p.username}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
