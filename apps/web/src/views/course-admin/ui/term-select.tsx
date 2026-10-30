'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../shared/ui'
import { courseKeys, fetchTermsPaged, type CourseTermRef } from '../../../entities/course'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
  // Нынешний семестр курса: старый семестр может не попасть в выдачу, подпись — отсюда.
  initial?: CourseTermRef | null
}

const NO_TERM = '__none__'
// Семестров в вузе немного — два-три в год, поиск не нужен. Но и текущей страницы вкладки
// «Семестры» мало: раньше модалки видели только её 20 строк. Свой запрос: сначала активные,
// дальше от новых к старым, до 100 — предел GET /terms.
const TERM_OPTIONS = { limit: 100, sort: 'isActive', order: 'desc' } as const

// Выбор семестра дисциплины. Пустое значение — «без семестра».
export function TermSelect({ id, value, onChange, initial }: Props) {
  const t = useTranslations('CourseAdmin')
  const { data } = useQuery({
    queryKey: courseKeys.terms(TERM_OPTIONS),
    queryFn: () => fetchTermsPaged(TERM_OPTIONS),
    staleTime: 60_000,
  })
  const terms: CourseTermRef[] = data?.items ?? []
  // Без нынешнего семестра в списке селект показал бы пустое значение, будто семестра нет.
  const options = initial && !terms.some((tm) => tm.id === initial.id) ? [initial, ...terms] : terms

  return (
    <Select value={value ?? NO_TERM} onValueChange={(v) => onChange(v === NO_TERM ? null : v)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_TERM}>{t('noTerm')}</SelectItem>
        {options.map((tm) => (
          <SelectItem key={tm.id} value={tm.id}>
            {tm.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
