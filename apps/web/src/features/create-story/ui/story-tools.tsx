'use client'

import { useTranslations } from 'next-intl'
import {
  AtSign,
  BarChart3,
  CalendarDays,
  Clock,
  ImagePlus,
  Link2,
  Loader2,
  Newspaper,
  Smile,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

export type StoryTool =
  'media' | 'text' | 'emoji' | 'mention' | 'link' | 'poll' | 'event' | 'schedule' | 'post'

const TOOLS: Record<StoryTool, { icon: LucideIcon; label: string }> = {
  media: { icon: ImagePlus, label: 'toolMedia' },
  text: { icon: Type, label: 'toolText' },
  emoji: { icon: Smile, label: 'toolEmoji' },
  mention: { icon: AtSign, label: 'toolMention' },
  link: { icon: Link2, label: 'addLink' },
  poll: { icon: BarChart3, label: 'addPoll' },
  event: { icon: CalendarDays, label: 'toolEvent' },
  schedule: { icon: Clock, label: 'toolPair' },
  post: { icon: Newspaper, label: 'toolPost' },
}

// Обычные инструменты сторис и университетские — разными группами: карточка пары или
// события — не стикер, а живая запись из расписания и событий вуза.
const GROUPS: { title: string; tools: StoryTool[] }[] = [
  { title: 'toolsBasic', tools: ['media', 'text', 'emoji', 'mention', 'link', 'poll'] },
  { title: 'toolsUniversity', tools: ['event', 'schedule', 'post'] },
]

/**
 * Инструменты сторис. Раскладка меняется с шириной, логика — одна:
 * - от 1280px — колонка слева, иконка и подпись;
 * - 768–1279px — узкая колонка из иконок, подпись во всплывающей подсказке;
 * - на телефоне — лента внизу с прокруткой вбок, подпись под иконкой.
 * Медиа — главное действие и выделено цветом; активен инструмент, чьи настройки открыты.
 */
export function StoryTools({
  active,
  disabled,
  busy,
  onPick,
}: {
  active: StoryTool | null
  disabled: Partial<Record<StoryTool, boolean>>
  /** Идёт загрузка видео — у «Медиа» крутится индикатор. */
  busy: boolean
  onPick: (tool: StoryTool) => void
}) {
  const t = useTranslations('Stories')
  return (
    <nav
      aria-label={t('tools')}
      className="flex shrink-0 gap-1 overflow-x-auto border-t border-white/10 px-2 py-2 md:w-16 md:flex-col md:gap-4 md:overflow-x-visible md:overflow-y-auto md:border-t-0 md:border-r md:px-2 md:py-3 xl:w-60 xl:px-3"
    >
      {GROUPS.map((group, gi) => (
        <div
          key={group.title}
          className={cn(
            'flex shrink-0 gap-1 md:flex-col',
            gi > 0 && 'border-l border-white/10 pl-1 md:border-t md:border-l-0 md:pt-4 md:pl-0',
          )}
        >
          <p className="hidden px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase xl:block">
            {t(group.title)}
          </p>
          {group.tools.map((tool) => {
            const { icon: Icon, label } = TOOLS[tool]
            const primary = tool === 'media'
            const isActive = active === tool
            return (
              <button
                key={tool}
                type="button"
                title={t(label)}
                aria-pressed={isActive}
                disabled={disabled[tool]}
                onClick={() => onPick(tool)}
                className={cn(
                  'flex min-w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none',
                  'md:size-11 md:min-w-0 md:p-0',
                  'xl:h-10 xl:w-full xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:text-sm',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : primary
                      ? 'text-primary hover:bg-primary/10'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tool === 'media' && busy ? (
                  <Loader2 className="size-5 animate-spin xl:size-4" aria-hidden />
                ) : (
                  <Icon className="size-5 xl:size-4" aria-hidden />
                )}
                <span className="md:sr-only xl:not-sr-only">{t(label)}</span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
