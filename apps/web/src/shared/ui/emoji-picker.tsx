'use client'

import { EmojiPicker as Frimousse } from 'frimousse'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

// Полноценный emoji-picker (§12) на frimousse (headless): категории, поиск, недавние.
// Данные emoji подгружаются библиотекой (emojibase) при первом открытии.
export function EmojiPicker({
  onPick,
  searchPlaceholder,
  className,
}: {
  onPick: (emoji: string) => void
  searchPlaceholder?: string
  className?: string
}) {
  return (
    <Frimousse.Root
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      className={cn(
        'isolate flex h-80 w-[19rem] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg',
        className,
      )}
    >
      <Frimousse.Search
        placeholder={searchPlaceholder}
        className="m-2 h-9 shrink-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
      />
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
                className="flex size-8 items-center justify-center rounded-md text-lg data-[active=true]:bg-muted hover:bg-muted"
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
