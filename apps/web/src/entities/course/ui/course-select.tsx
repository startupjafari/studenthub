'use client'

import { useMemo, useState } from 'react'
import { AsyncSelect, type AsyncSelectItem, type ControlSize } from '../../../shared/ui'
import type { CourseItem } from '../model/types'

interface CourseSelectProps {
  id?: string
  /** Все дисциплины, из которых выбирают (`fetchAllCourses`), — поиск идёт по ним. */
  courses: CourseItem[]
  value: string
  onChange: (next: string) => void
  loading?: boolean
  placeholder?: string
  size?: ControlSize
}

// Сколько совпадений показывать в раскрытом списке: дальше человек уточняет поиском.
const MAX_ITEMS = 100

function courseLabel(c: CourseItem): string {
  return `${c.subject.name} · ${c.group.name}`
}

/**
 * Выбор дисциплины (курса группы) с поиском по названию, коду и группе. Обычный селект
 * с сотнями строк факультета листать бесполезно, а первая сотня по алфавиту прятала
 * остальные дисциплины вовсе. Семестр — второй строкой: одноимённые курсы разных
 * семестров иначе не различить.
 */
export function CourseSelect({
  id,
  courses,
  value,
  onChange,
  loading,
  placeholder,
  size,
}: CourseSelectProps) {
  const [query, setQuery] = useState('')

  const items: AsyncSelectItem[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    return courses
      .filter(
        (c) =>
          !q ||
          courseLabel(c).toLowerCase().includes(q) ||
          (c.subject.code ?? '').toLowerCase().includes(q),
      )
      .slice(0, MAX_ITEMS)
      .map((c) => ({ value: c.id, label: courseLabel(c), hint: c.term?.name ?? null }))
  }, [courses, query])

  const selected = courses.find((c) => c.id === value)

  return (
    <AsyncSelect
      id={id}
      value={value}
      onChange={onChange}
      selectedLabel={selected ? courseLabel(selected) : null}
      items={items}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      placeholder={placeholder}
      size={size}
    />
  )
}
