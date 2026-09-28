'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { Button, Input } from '../../../shared/ui'

/**
 * Быстрое добавление одной строки списка прямо в шаге мастера.
 *
 * Существует ради темпа. Факультетов у вуза десятки, и уводить человека в отдельный
 * раздел, а оттуда в модалку — на каждый из них — значит превратить получасовую работу
 * в вечернюю. Поле остаётся сфокусированным после сохранения: список набивают подряд,
 * а не по одному с возвратом мышью.
 *
 * Полный раздел при этом никуда не девается: здесь заводят название, там — всё
 * остальное. Мастер не повторяет управление структурой, он доводит до первого запуска.
 */
export function QuickAdd({
  placeholder,
  disabled,
  pending,
  onAdd,
  children,
}: {
  placeholder: string
  disabled?: boolean
  pending?: boolean
  onAdd: (name: string) => Promise<unknown>
  /** Дополнительные поля слева от строки ввода — например выбор факультета у групп. */
  children?: React.ReactNode
}) {
  const t = useTranslations('Setup')
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    const value = name.trim()
    if (!value || disabled) return
    await onAdd(value)
    setName('')
    inputRef.current?.focus()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      {children}
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="sm:flex-1"
      />
      <Button type="submit" disabled={disabled || !name.trim()} loading={pending}>
        <Plus className="size-4" aria-hidden />
        {t('add')}
      </Button>
    </form>
  )
}
