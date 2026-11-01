'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_QUERY,
  fetchSearch,
  searchKeys,
} from '../../../entities/search'
import { useAppSelector } from '../../../shared/store'
import { Avatar, AvatarFallback, AvatarImage, Input, Modal, Skeleton } from '../../../shared/ui'

/**
 * Выбор человека для отметки на кадре: тот же поиск людей, что у палитры (свой вуз, без
 * удалённых и заблокированных). Подойдёт ли человек под аудиторию сторис, решает сервер
 * при публикации — здесь об этом предупреждает подсказка.
 */
export function MentionPicker({
  onPick,
  onClose,
}: {
  onPick: (userId: string, name: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  const tErr = useTranslations('Errors')
  const myId = useAppSelector((s) => s.auth.user?.id)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const ready = debounced.length >= SEARCH_MIN_QUERY
  const search = useQuery({
    queryKey: searchKeys.query(debounced, ['people']),
    queryFn: () => fetchSearch(debounced, ['people']),
    enabled: ready,
  })
  const people = (search.data?.people ?? []).filter((p) => p.id !== myId)

  return (
    <Modal onClose={onClose} title={t('mentionTitle')} size="md">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('mentionSearch')}
            aria-label={t('mentionSearch')}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('mentionHint')}</p>
        {!ready ? null : search.isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-xl" />
            ))}
          </div>
        ) : search.isError ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{tErr('INTERNAL_ERROR')}</p>
        ) : people.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('mentionEmpty')}</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {people.map((p) => {
              const name = `${p.firstName} ${p.lastName}`
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p.id, name)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <Avatar className="size-8">
                      {p.avatarUrl && <AvatarImage src={p.avatarUrl} alt="" />}
                      <AvatarFallback>
                        {p.firstName.charAt(0)}
                        {p.lastName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{name}</span>
                      {p.username && (
                        <span className="block truncate text-xs text-muted-foreground">
                          @{p.username}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
