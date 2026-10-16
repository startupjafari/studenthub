'use client'

import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Card, Checkbox, EmptyState, FieldError, Label } from '../../../shared/ui'

// Строительные блоки редактора услуги. Один вид поля на всех трёх вкладках: подпись,
// контрол, подсказка и ошибка всегда в одном порядке и с одним шагом (DESIGN_SYSTEM §10.3),
// поэтому соседние поля в сетке встают ровно друг против друга.

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  /** id контрола: подпись связывается с ним (у селекта — с его триггером). */
  htmlFor: string
  hint?: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError>{error}</FieldError>
    </div>
  )
}

/**
 * Строка-флаг панели (идиом `SettingRow`, DESIGN_SYSTEM §10.6): слева название и пояснение,
 * справа контрол. Вся строка — `label`: нажатие по тексту переключает флаг, как в настройках.
 */
export function OptionRow({
  label,
  hint,
  control,
}: {
  label: string
  hint?: string
  control: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 border-b border-border py-3 last:border-b-0 has-[:disabled]:cursor-default">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="flex shrink-0">{control}</span>
    </label>
  )
}

/**
 * Список элементов вкладки (документы, вопросы анкеты). Пусто — `EmptyState` во всю высоту
 * раздела с кнопкой добавления по центру (DESIGN_SYSTEM §10.4); есть элементы — карточки
 * столбиком и та же кнопка во всю ширину под ними.
 */
export function ItemList({
  empty,
  addLabel,
  onAdd,
  readOnly,
  children,
}: {
  empty: { icon: ReactNode; title: string; description: string } | null
  addLabel: string
  onAdd: () => void
  readOnly: boolean
  children: ReactNode
}) {
  const add = readOnly ? null : (
    <Button type="button" variant="outline" onClick={onAdd}>
      <Plus className="size-4" aria-hidden /> {addLabel}
    </Button>
  )
  if (empty) {
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={add}
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4">{children}</ol>
      {add && <div className="grid">{add}</div>}
    </div>
  )
}

/** Карточка элемента списка: поля сверху, снизу — флаг «обязательный» слева и удаление справа. */
export function ItemCard({
  required,
  removeLabel,
  onRemove,
  children,
}: {
  required: ReactNode
  removeLabel: string
  onRemove?: () => void
  children: ReactNode
}) {
  return (
    <li>
      <Card className="gap-4 p-4">
        {children}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          {required}
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={removeLabel}
              title={removeLabel}
              onClick={onRemove}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </Card>
    </li>
  )
}

/** Флаг «обязательный» в подвале карточки: чекбокс с подписью, нажимается вся подпись. */
export function RequiredToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium has-[:disabled]:cursor-default">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
      />
      {label}
    </label>
  )
}
