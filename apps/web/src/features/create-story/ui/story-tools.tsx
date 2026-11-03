'use client'

import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import {
  AtSign,
  BarChart3,
  CalendarDays,
  Clock,
  Link2,
  Newspaper,
  Smile,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

export type StoryTool =
  'text' | 'emoji' | 'mention' | 'link' | 'poll' | 'event' | 'schedule' | 'post'

const TOOLS: Record<StoryTool, { icon: LucideIcon; label: string }> = {
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
  { title: 'toolsBasic', tools: ['text', 'emoji', 'mention', 'link', 'poll'] },
  { title: 'toolsUniversity', tools: ['event', 'schedule', 'post'] },
]

/**
 * Инструменты сторис. Одна логика, три раскладки:
 * - от 1024px — колонка с подписями: пункт 40px, иконка 18px, 12px до подписи и по краям;
 * - 768–1023px — колонка иконок 40×40, подпись во всплывающей подсказке;
 * - на телефоне — лента внизу с прокруткой вбок, подпись под иконкой.
 * Все пункты стоят на одной вертикальной оси; группы разделены линией по той же сетке.
 * Медиа здесь нет: фото или видео выбирают на пустом кадре — там же, где текстовую сторис.
 * Активен инструмент, чьи настройки открыты.
 */
export function StoryTools({
  active,
  disabled,
  onPick,
}: {
  active: StoryTool | null
  disabled: Partial<Record<StoryTool, boolean>>
  onPick: (tool: StoryTool) => void
}) {
  const t = useTranslations('Stories')
  return (
    <nav
      aria-label={t('tools')}
      className="flex h-full min-h-0 items-stretch overflow-x-auto px-2 py-1 md:flex-col md:items-center md:overflow-x-visible md:overflow-y-auto md:p-4 lg:items-stretch"
    >
      {GROUPS.map((group, gi) => (
        <Fragment key={group.title}>
          {gi > 0 && (
            <span
              aria-hidden
              className="mx-1 my-2 w-px shrink-0 bg-white/10 md:mx-0 md:my-3 md:h-px md:w-10 lg:w-full"
            />
          )}
          <div className="flex shrink-0 md:flex-col md:gap-1">
            <p className="hidden h-8 items-center px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase lg:flex">
              {t(group.title)}
            </p>
            {group.tools.map((tool) => {
              const { icon: Icon, label } = TOOLS[tool]
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
                    'flex shrink-0 items-center rounded-lg font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none',
                    // телефон: иконка над подписью
                    'h-14 w-16 flex-col justify-center gap-1 text-[11px]',
                    // планшет: квадрат 40×40
                    'md:size-10 md:gap-0',
                    // ноутбук и шире: строка 40px, 12px по краям и до подписи
                    'lg:h-10 lg:w-full lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm',
                    isActive
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-[18px] shrink-0" aria-hidden />
                  <span className="truncate md:sr-only lg:not-sr-only">{t(label)}</span>
                </button>
              )
            })}
          </div>
        </Fragment>
      ))}
    </nav>
  )
}
