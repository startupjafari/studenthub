'use client'

import type { Ref } from 'react'
import { useTranslations } from 'next-intl'
import { Check, EyeOff, ListChecks, Trash2, Users } from 'lucide-react'
import type { PollView } from '../../../entities/poll'
import { Button, MosaicTile, Progress, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/** Сколько вариантов помещается на плитке; остальные — подписью «+N» в подвале. */
const PREVIEW_OPTIONS = 3

// Плитка опроса в сетке профиля — того же квадрата, что посты, фото и статьи. Раньше во
// вкладке стояли полные карточки с голосованием: разной высоты (два варианта против восьми),
// в две колонки, и сетка выглядела случайной. Плитка — только «о чём опрос и как идёт»:
// статус, вопрос, до трёх полосок итогов и число участников. Голосование, отмена голоса и
// полные итоги — в окне с той же карточкой `PollCard`, оно открывается нажатием на плитку.
//
// Плитка — контейнер (`@container`): на телефоне она в треть экрана, и полоски с подписями
// там не читаются. Узкая плитка показывает статус, вопрос и участников; варианты появляются
// с ширины 13rem — так решает ширина самой плитки, а не окна (рядом боковая панель фильтров).
export function PollTile({
  poll,
  canDelete,
  deleteLabel,
  onOpen,
  onDelete,
}: {
  poll: PollView
  /** Автор или модератор scope: на плитке — кнопка удаления (решает и проверяет сервер). */
  canDelete: boolean
  /** «Удалить» у автора, «Удалить (модерация)» у модератора. */
  deleteLabel: string
  onOpen: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Profile')
  const draft = poll.status === 'DRAFT'
  const showResults = poll.canSeeResults
  const maxVotes = Math.max(0, ...poll.options.map((o) => o.votes))
  // Итоги видны — на плитке лидеры (ради них её и смотрят), порядок при равенстве — исходный:
  // сортировка стабильная. Итоги скрыты — первые варианты в порядке опроса.
  const preview = (
    showResults ? [...poll.options].sort((a, b) => b.votes - a.votes) : poll.options
  ).slice(0, PREVIEW_OPTIONS)
  const rest = poll.options.length - preview.length

  return (
    <MosaicTile
      className={cn(
        '@container bg-card',
        // Подъём при наведении — отклик «это можно открыть», как увеличение обложки у
        // соседних плиток; текст масштабом не трогаем — он бы мылился.
        'transition duration-(--motion-micro) hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/30',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 flex flex-col gap-1.5 p-2 text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:ring-inset @min-[13rem]:gap-2 @min-[13rem]:p-3"
      >
        {/* Справа место под кнопку удаления: на телефоне она видна всегда. */}
        <span className={cn('flex min-w-0 items-center gap-1.5', canDelete && 'pr-9')}>
          <PollStatus draft={draft} closed={poll.closed} />
          {poll.anonymous && (
            <span title={t('pollAnonymous')} className="text-muted-foreground">
              <EyeOff className="size-3.5" aria-hidden />
              <span className="sr-only">{t('pollAnonymous')}</span>
            </span>
          )}
          {poll.multiple && (
            <span title={t('pollMultipleAnswers')} className="text-muted-foreground">
              <ListChecks className="size-3.5" aria-hidden />
              <span className="sr-only">{t('pollMultipleAnswers')}</span>
            </span>
          )}
        </span>

        <span className="line-clamp-4 text-xs leading-snug font-semibold break-words @min-[13rem]:line-clamp-2 @min-[13rem]:text-sm">
          {poll.question}
        </span>

        <ul className="hidden min-h-0 flex-col gap-1.5 @min-[13rem]:flex">
          {preview.map((o) => {
            const pct = poll.totalVotes > 0 ? Math.round((o.votes / poll.totalVotes) * 100) : 0
            const mine = poll.myVotes.includes(o.id)
            const leader = showResults && maxVotes > 0 && o.votes === maxVotes
            return (
              <li key={o.id} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2 text-xs leading-4">
                  <span
                    className={cn(
                      'flex min-w-0 items-center gap-1',
                      leader && 'font-semibold',
                      mine && 'text-primary',
                    )}
                  >
                    {mine ? (
                      <Check className="size-3 shrink-0" aria-label={t('pollYourVote')} />
                    ) : (
                      !showResults && (
                        // Итоги скрыты — вместо полоски кружок варианта: пустая полоса читалась
                        // бы как «0 %», а это неправда.
                        <span
                          className="size-2.5 shrink-0 rounded-full border border-input"
                          aria-hidden
                        />
                      )
                    )}
                    <span className="truncate">{o.text}</span>
                  </span>
                  {showResults && (
                    <span
                      className={cn(
                        'shrink-0 font-semibold tabular-nums',
                        leader ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {pct}%
                    </span>
                  )}
                </span>
                {showResults && (
                  <Progress
                    value={pct}
                    aria-hidden
                    className="h-1"
                    indicatorClassName={leader ? 'bg-primary' : 'bg-muted-foreground/40'}
                  />
                )}
              </li>
            )
          })}
        </ul>

        <span className="mt-auto flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span
            className="inline-flex items-center gap-1"
            title={t('pollParticipants', { count: poll.participants })}
          >
            <Users className="size-3.5" aria-hidden />
            <span aria-hidden>{poll.participants}</span>
            <span className="sr-only">{t('pollParticipants', { count: poll.participants })}</span>
          </span>
          {!showResults && (
            <span title={t('pollResultsHidden')} className="hidden @min-[13rem]:inline">
              <EyeOff className="size-3.5" aria-hidden />
              <span className="sr-only">{t('pollResultsHidden')}</span>
            </span>
          )}
          {rest > 0 && (
            <span className="ml-auto hidden truncate @min-[13rem]:inline">
              {t('pollMoreOptions', { count: rest })}
            </span>
          )}
        </span>
      </button>

      {canDelete && (
        <div className="absolute top-1.5 right-1.5 z-10 flex opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100 max-lg:opacity-100 @min-[13rem]:top-2 @min-[13rem]:right-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon
            aria-label={deleteLabel}
            title={deleteLabel}
            onClick={onDelete}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
      )}
    </MosaicTile>
  )
}

// Статус — плашкой с текстом, а не одним цветом: «идёт» и «завершён» различимы и без цвета.
function PollStatus({ draft, closed }: { draft: boolean; closed: boolean }) {
  const t = useTranslations('Profile')
  const base =
    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium'
  if (draft) {
    return <span className={cn(base, 'bg-warning text-warning-foreground')}>{t('draft')}</span>
  }
  if (closed) {
    return (
      <span className={cn(base, 'bg-muted text-muted-foreground')}>{t('pollStatusClosed')}</span>
    )
  }
  return (
    <span className={cn(base, 'bg-success/10 text-success')}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t('pollStatusActive')}
    </span>
  )
}

// Скелетон плитки — того же квадрата и той же раскладки: статус, две строки вопроса,
// полоски (с 13rem, как у плитки) и подвал. Догруженный опрос встаёт на его место без сдвига.
export function PollTileSkeleton({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return (
    <MosaicTile ref={ref} aria-hidden className="@container bg-card">
      <div className="flex size-full flex-col gap-1.5 p-2 @min-[13rem]:gap-2 @min-[13rem]:p-3">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
        <div className="mt-1 hidden flex-col gap-2.5 @min-[13rem]:flex">
          {Array.from({ length: PREVIEW_OPTIONS }, (_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-1 w-full rounded-full" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-auto h-3 w-12" />
      </div>
    </MosaicTile>
  )
}
