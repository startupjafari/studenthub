'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AtSign, CheckCheck, ChevronDown, Heart, type LucideIcon } from 'lucide-react'
import { RowContextMenu } from '../../../shared/ui'

/**
 * Плавающие кнопки ленты справа над панелью ввода (Telegram): сверху «к реакции» и
 * «к упоминанию», снизу «вниз». Кнопки «@» и «♥» видны и у самого низа — пока есть что
 * показать; «вниз» — только когда лента пролистана вверх. Скрытая нижняя кнопка не
 * оставляет дыры: колонка прижата к низу, и верхние опускаются на её место.
 *
 * Появление — въезд снизу с затуханием (`tw-animate-css`), при reduced-motion глобальные
 * правила оставляют только затухание.
 */
export interface MessageListFabProps {
  /** Отступ снизу — над плавающей панелью ввода. */
  bottom: number
  showDown: boolean
  /** Непрочитанных ниже видимого — число на «вниз». */
  unreadBelow: number
  mentionCount: number
  reactionCount: number
  onDown: () => void
  onMention: () => void
  onReaction: () => void
  onReadAllMentions: () => void
  onReadAllReactions: () => void
}

export function MessageListFab({
  bottom,
  showDown,
  unreadBelow,
  mentionCount,
  reactionCount,
  onDown,
  onMention,
  onReaction,
  onReadAllMentions,
  onReadAllReactions,
}: MessageListFabProps) {
  const t = useTranslations('Chats')
  if (!showDown && mentionCount === 0 && reactionCount === 0) return null
  return (
    <div
      className="pointer-events-none absolute right-3 z-20 flex flex-col items-center gap-3 md:right-4 md:gap-2"
      style={{ bottom }}
    >
      {reactionCount > 0 && (
        <FabButton
          icon={Heart}
          label={t('tgBehavior.nextReaction')}
          count={reactionCount}
          onClick={onReaction}
          onReadAll={onReadAllReactions}
        />
      )}
      {mentionCount > 0 && (
        <FabButton
          icon={AtSign}
          label={t('tgBehavior.nextMention')}
          count={mentionCount}
          onClick={onMention}
          onReadAll={onReadAllMentions}
        />
      )}
      {showDown && (
        <FabButton
          icon={ChevronDown}
          label={
            unreadBelow > 0
              ? t('tgBehavior.scrollDownUnread', { count: unreadBelow })
              : t('scrollToBottom')
          }
          count={unreadBelow}
          onClick={onDown}
        />
      )}
    </div>
  )
}

function FabButton({
  icon: Icon,
  label,
  count,
  onClick,
  onReadAll,
}: {
  icon: LucideIcon
  label: string
  count: number
  onClick: () => void
  /** Правый клик — «Прочитать всё» (как у кнопок упоминаний и реакций в Telegram). */
  onReadAll?: () => void
}) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const compact =
    count > 0
      ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
          count,
        )
      : null

  return (
    <div className="pointer-events-auto relative duration-(--motion-menu) animate-in fade-in-0 slide-in-from-bottom-6">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={
          onReadAll
            ? (e) => {
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                // С клавиатуры (Shift+F10) координат нет — меню у самой кнопки.
                const keyboard = e.clientX === 0 && e.clientY === 0
                setMenu({ x: keyboard ? r.left : e.clientX, y: keyboard ? r.top : e.clientY })
              }
            : undefined
        }
        aria-label={label}
        title={label}
        className="flex size-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-md outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20 active:scale-95 md:size-12"
      >
        <Icon className="size-6" aria-hidden />
      </button>
      {compact && (
        <span
          aria-hidden
          // На телефоне счётчик над кнопкой по центру, на ПК — в правом верхнем углу (Telegram).
          className="pointer-events-none absolute -top-2.5 left-1/2 flex h-5 min-w-5 -translate-x-1/2 items-center justify-center rounded-full bg-primary px-1.5 text-[0.7rem] font-semibold tabular-nums text-primary-foreground ring-2 ring-background md:-top-1 md:-right-1 md:left-auto md:translate-x-0"
        >
          {compact}
        </span>
      )}
      {menu && onReadAll && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={label}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'readAll',
              label: t('tgBehavior.markAllRead'),
              icon: CheckCheck,
              onClick: onReadAll,
            },
          ]}
        />
      )}
    </div>
  )
}
