'use client'

import { Search, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from '../../../shared/ui'
import { identityColor, identityInitials } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { SwitchVisual } from './profile-info-card'

// Общие детали экранов управления группой (group-management.tsx, group-permissions.tsx,
// chat-members-list.tsx). Раньше у каждого экрана были свои отступы, свои заглушки и своя
// пустота — экраны одной колонки выглядели собранными из разных приложений. Здесь — одна
// грамматика, как в настройках Telegram Web и Slack: заголовок секции, карточка строк,
// подпись под карточкой.

/**
 * Строка настройки: высота не ниже 44 px (цель касания), иконка — своя колонка, значение и
 * шеврон справа. Наведение и нажатие — короткой сменой фона (`--motion-micro`): отклик виден
 * сразу, но не мигает.
 */
export const MANAGE_ROW =
  'flex min-h-11 w-full cursor-pointer items-center gap-4 px-4 py-2.5 text-left text-[0.9375rem] outline-none duration-(--motion-micro) hover:bg-muted/40 active:bg-muted/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50'

/** Строка человека в списке: тот же отклик, что у строк настроек. */
export const PERSON_ROW =
  'transition-colors duration-(--motion-micro) hover:bg-muted/40 active:bg-muted/60'

/**
 * Заголовок секции над карточкой — мелкий, цветом акцента, как в настройках Telegram.
 * `flush` — над списком людей без карточки: текст встаёт по левому краю аватаров, а не по
 * отступу карточки.
 */
export function SectionTitle({
  children,
  flush = false,
  className,
}: {
  children: React.ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <h3
      className={cn(
        'mt-5 mb-1.5 px-4 text-[0.8125rem] font-medium text-primary',
        !flush && 'mx-3',
        className,
      )}
    >
      {children}
    </h3>
  )
}

/** Подпись под карточкой — пояснение, как у секций настроек Telegram. `flush` — как у заголовка. */
export function CardHint({
  children,
  flush = false,
  className,
}: {
  children: React.ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <p
      className={cn(
        'mt-2 px-4 text-xs leading-relaxed text-muted-foreground',
        !flush && 'mx-3',
        className,
      )}
    >
      {children}
    </p>
  )
}

/**
 * Блок, который появляется и прячется по смыслу (например, «Одобрять вступление» есть
 * только у группы по ссылке). Высота едет через `grid-template-rows` 0fr → 1fr — без замера
 * в JS, — вместе с прозрачностью, поэтому соседи ниже не прыгают, а сдвигаются. Это не
 * строка списка (там анимация высоты запрещена, DESIGN_SYSTEM §7), а единичный блок в
 * конце экрана. Скрытое — `inert`: не берёт фокус и не читается скринридером.
 */
export function Reveal({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-(--motion-large) motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      {/* Отступ от соседей — `mt-*` у содержимого, а не у этой обёртки: внутри
          `overflow-hidden` поля не схлопываются, и кольцо карточки (оно снаружи её края)
          не срезается. */}
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * Пустой список — компактно: значок в круге, заголовок и одна-две строки пояснения по центру.
 * Не пунктирная рамка на всю колонку (`TabEmpty`): в узкой колонке она съедала экран и
 * читалась как ошибка вёрстки, а не как «здесь пока никого».
 */
export function ManageEmpty({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-8 py-10 text-center duration-(--motion-page) animate-in fade-in-0 zoom-in-95">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {hint && (
        <p className="mt-1 max-w-72 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

const SKELETON_WIDTHS = ['w-3/5', 'w-1/2', 'w-2/5', 'w-[55%]']

/**
 * Заглушка списка людей той же геометрии, что настоящие строки (аватар 44 px, две строки
 * текста, py-1.5): пришли данные — строки встают на место заглушек без сдвига экрана.
 */
export function PersonRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="py-1" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-1.5">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-3.5', SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Аватар человека с цветом и инициалами по id — как во всех списках чатов. */
export function PersonAvatar({
  id,
  name,
  url,
  online = false,
}: {
  id: string
  name: string
  url: string | null | undefined
  online?: boolean
}) {
  return (
    <span className="relative shrink-0">
      <Avatar className="size-11">
        {url && <AvatarImage src={url} alt={name} />}
        <AvatarFallback className={cn('text-white', identityColor(id))}>
          {identityInitials(name)}
        </AvatarFallback>
      </Avatar>
      {online && (
        <span
          className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-background bg-success"
          aria-hidden
        />
      )}
    </span>
  )
}

/**
 * Поиск по списку. Прилипает к верху колонки, когда список длинный и его листают: искать
 * приходится как раз с середины. Подложка полупрозрачная с размытием — как у липких вкладок
 * профиля. Esc с текстом в поле очищает поле, а не уводит экран назад.
 */
export function ManageSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="sticky top-0 z-10 bg-background/85 px-3 pt-3 pb-2 backdrop-blur-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && value) {
              e.preventDefault()
              onChange('')
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 w-full rounded-xl border border-input bg-muted/40 pr-3 pl-9 text-sm outline-none transition-[border-color,box-shadow,background-color] duration-(--motion-micro) focus-visible:border-ring focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-ring/15"
        />
      </div>
    </div>
  )
}

/**
 * Строка-переключатель. Вся строка — `role="switch"`; пока значение сохраняется (`busy`),
 * в бегунке крутится маленький индикатор: переключатель уже стоит в новом положении
 * (оптимистично), а индикатор честно говорит, что сервер ещё не ответил.
 */
export function SwitchRow({
  icon: Icon,
  label,
  checked,
  disabled,
  busy = false,
  onToggle,
}: {
  icon?: LucideIcon
  label: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onToggle}
      className={MANAGE_ROW}
    >
      {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 flex-1">{label}</span>
      <SwitchVisual checked={checked} busy={busy} />
    </button>
  )
}
