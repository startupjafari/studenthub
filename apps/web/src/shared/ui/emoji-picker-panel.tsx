'use client'

import { EmojiPicker as Frimousse } from 'frimousse'
import { Loader2, Search } from 'lucide-react'
import { useLocale } from 'next-intl'
import { cn } from '../lib/utils'
import { EMOJI_PICKER_SIZES as SIZES, type EmojiPickerProps } from './emoji-picker'

/**
 * Язык названий категорий и поиска по emoji. Список берётся у emojibase, и казахского в
 * нём нет — для `kk` показываем русские названия: «Smileys & emotion» посреди русского
 * интерфейса читается хуже, чем русская подпись в казахском.
 */
const PICKER_LOCALE: Record<string, 'ru' | 'en'> = { ru: 'ru', kk: 'ru', en: 'en' }

// Полноценный emoji-picker (§12) на frimousse (headless): категории, поиск, недавние.
// Данные emoji подгружаются библиотекой (emojibase) при первом открытии.
export function EmojiPickerPanel({
  onPick,
  searchPlaceholder,
  className,
  size = 'md',
}: EmojiPickerProps) {
  const scale = SIZES[size]
  const locale = useLocale()
  return (
    <Frimousse.Root
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      locale={PICKER_LOCALE[locale] ?? 'ru'}
      columns={scale.columns}
      className={cn(
        'isolate flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg',
        scale.root,
        className,
      )}
    >
      {/* Лупа внутри поля: пустое поле над сеткой смайлов читается как «фильтр», а не как
          «поиск», и до него не доходят — в Telegram ровно поэтому стоит значок. */}
      <div className="relative m-2 shrink-0">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Frimousse.Search
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        />
      </div>
      <Frimousse.Viewport className="relative flex-1 outline-none">
        <Frimousse.Loading className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </Frimousse.Loading>
        <Frimousse.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          —
        </Frimousse.Empty>
        <Frimousse.List
          className="select-none pb-1"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                {...props}
                className="bg-popover px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground"
              >
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div {...props} className="scroll-my-1 px-1">
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                {...props}
                className={cn(
                  'flex items-center justify-center rounded-md data-[active=true]:bg-muted hover:bg-muted',
                  scale.cell,
                )}
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </Frimousse.Viewport>
    </Frimousse.Root>
  )
}
