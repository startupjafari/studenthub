'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '../../../shared/lib/utils'

/**
 * Подсказка эмодзи над полем ввода (Telegram EmojiTooltip): ряд смайлов по `:запросу` или по
 * слову под курсором. Клавиатура живёт в поле (←/→, Enter/Tab, Esc — см.
 * useEmojiSuggestions), ряд только показывает выбор и докручивает к нему. Нажатие не
 * забирает фокус у поля — иначе пропал бы запрос перед курсором, который смайл и заменит.
 */
export function ComposerEmojiTooltip({
  id,
  items,
  activeIndex,
  showActive,
  onPick,
  onHover,
}: {
  id: string
  items: string[]
  activeIndex: number
  /** Подсвечивать выбранный: по слову под курсором стрелки не ходят, и подсветка обманывала бы. */
  showActive: boolean
  onPick: (emoji: string) => void
  onHover: (index: number) => void
}) {
  const t = useTranslations('Chats')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeIndex])

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-orientation="horizontal"
      aria-label={t('tgComposer2.emojiSuggestions')}
      className="absolute bottom-full left-0 z-20 mb-2 flex max-w-full gap-0.5 overflow-x-auto rounded-xl border border-border bg-popover p-1 shadow-lg duration-(--motion-menu) [scrollbar-width:none] animate-in fade-in-0 slide-in-from-bottom-1 lg:left-12 lg:max-w-[calc(100%-6rem)] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((emoji, i) => (
        <button
          key={emoji}
          type="button"
          id={`${id}-${i}`}
          data-index={i}
          role="option"
          aria-selected={showActive && i === activeIndex}
          aria-label={emoji}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onPointerMove={() => onHover(i)}
          onClick={() => onPick(emoji)}
          className={cn(
            'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-2xl leading-none transition-colors',
            showActive && i === activeIndex ? 'bg-muted' : 'hover:bg-muted/60',
          )}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
