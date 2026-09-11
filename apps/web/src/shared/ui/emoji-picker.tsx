'use client'

import { EmojiPicker as Frimousse } from 'frimousse'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

// Два размера пикера. Разница не в одной ширине панели: число колонок и клетка связаны —
// frimousse раскладывает ряд на `columns` клеток фиксированного размера, и если их
// произведение шире дорожки, крайние уезжают под обрез. Поэтому размер выбирается
// парой, а не классом снаружи.
//
//  · md — выбор реакции в меню сообщения: панель всплывает у пузыря, и место там дорого;
//  · lg — панель ввода чата: сюда приходят выбирать смайл глазами, и 32-пиксельная клетка
//    превращает выбор в разглядывание.
const SIZES = {
  md: { columns: 9, root: 'h-80 w-[19rem]', cell: 'size-8 text-lg' },
  lg: { columns: 7, root: 'h-[26rem] w-[21rem]', cell: 'size-11 text-[1.75rem]' },
} as const

// Полноценный emoji-picker (§12) на frimousse (headless): категории, поиск, недавние.
// Данные emoji подгружаются библиотекой (emojibase) при первом открытии.
export function EmojiPicker({
  onPick,
  searchPlaceholder,
  className,
  size = 'md',
}: {
  onPick: (emoji: string) => void
  searchPlaceholder?: string
  className?: string
  /** Размер панели и клетки. `lg` — там, где смайл выбирают, а не подтверждают реакцией. */
  size?: keyof typeof SIZES
}) {
  const scale = SIZES[size]
  return (
    <Frimousse.Root
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      columns={scale.columns}
      className={cn(
        'isolate flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg',
        scale.root,
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
