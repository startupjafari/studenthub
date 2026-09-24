'use client'

import { useTranslations } from 'next-intl'
import { ArrowLeft, Search } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

// Общая оболочка «экранов» левой колонки чатов: папки, чёрный список, создание группы.
//
// Всё, что раньше открывалось модальным окном поверх списка, теперь встаёт на его место.
// Окно и список дрались за одну и ту же площадь: на телефоне окно занимало те же 100% ширины,
// но с отступами и затемнением, а на десктопе половину экрана занимала переписка, которой в
// этот момент никто не пользовался. Панель занимает колонку целиком и на телефоне читается
// как обычный экран с «назад» — тем же жестом, что и выход из переписки.

/** Колонка-панель: та же геометрия, что у самого списка чатов (ConversationList). */
export function ColumnPanel({
  embedded,
  hidden,
  children,
}: {
  /** Список чатов живёт в сайдбаре десктопа (портал) — панель там же. */
  embedded: boolean
  /** Колонка скрыта на узком экране (открыта переписка) — как и сам список чатов. */
  hidden: boolean
  children: React.ReactNode
}) {
  return (
    <aside
      className={cn(
        embedded
          ? 'flex h-full w-full flex-col'
          : cn(
              'w-full shrink-0 flex-col border-r border-border md:flex md:w-80 lg:hidden',
              hidden ? 'hidden md:flex' : 'flex',
            ),
      )}
    >
      {children}
    </aside>
  )
}

/**
 * Шапка панели: «назад», заголовок, необязательное действие справа.
 *
 * Высота та же, что у шапки списка чатов и шапки переписки (py-3 вокруг 40-px кнопок):
 * нижние границы всех трёх идут одной линией, и переход между экранами не дёргает вёрстку.
 */
export function PanelHeader({
  title,
  onBack,
  action,
}: {
  title: string
  onBack: () => void
  action?: React.ReactNode
}) {
  const t = useTranslations('Chats')
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('back')}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-lg font-bold">{title}</span>
      {action}
    </div>
  )
}

/** Кнопка-иконка в шапке панели: подтверждение, добавление — всё правым краем строки. */
export function PanelHeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** Заголовок блока внутри панели — «Папки», «Выбранные чаты», «Участники». */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
      {children}
    </p>
  )
}

/** Поле поиска в панели — отдельной строкой под шапкой, как в списке чатов. */
export function PanelSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        />
      </div>
    </div>
  )
}
