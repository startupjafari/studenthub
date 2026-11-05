'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowUpRight,
  AtSign,
  BarChart3,
  ChevronRight,
  Link2,
  Loader2,
  Users,
  X,
} from 'lucide-react'
import { cn } from '../../../shared/lib/utils'
import {
  planInteractive,
  pollPercents,
  pollShape,
  pollVisibleCount,
  safeStoryLink,
  type InteractiveKind,
  type PollShape,
} from '../model/interactive-layout'
import type { StoryPoll } from '../model/types'

/** Отметка человека в кадре — то, что нужно списку «Упомянуты». */
export interface StoryMentionRef {
  userId: string
  name: string
}

/** Что раскрыто поверх кадра: полный опрос или список отмеченных. */
export type StoryExpanded = 'poll' | 'people'

export interface StoryInteractiveProps {
  poll: StoryPoll | null
  linkUrl: string | null
  linkLabel: string | null
  mentions: readonly StoryMentionRef[]
  /** Размер кадра — от него зависят раскладка и сколько вариантов опроса видно. */
  frame: { width: number; height: number }
  /** Превью редактора: всё видно, но ничего не нажимается. */
  preview?: boolean
  /** Вариант, голос за который сейчас уходит, — у него индикатор, остальные ждут. */
  votingOptionId?: string | null
  onVote?: (optionId: string) => void
  onExpand?: (what: StoryExpanded) => void
}

// Тёмная полупрозрачная подложка интерактивных стикеров: читается и на светлом, и на тёмном
// кадре без размытия (blur на видео в каждом кадре — заметная нагрузка на слабых телефонах).
const DARK_CHIP =
  'inline-flex h-9 max-w-full items-center gap-1.5 rounded-xl bg-black/55 px-3 text-sm font-medium text-white ring-1 ring-white/15 transition-colors duration-150 hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none'

/**
 * Интерактивный слой сторис — опрос, ссылка и «Упомянуты · N» одним блоком в нижней зоне
 * кадра, над системным рядом. Раскладку выбирает `planInteractive`: обычно опрос карточкой
 * и под ним компактные стикеры, а когда тесно — вкладки, где раскрыт один блок за раз.
 *
 * Тот же компонент рисует превью в редакторе (`preview`): автор видит ровно то, что увидит
 * зритель. Нажатия здесь не всплывают к жестам кадра: слой живёт вне зоны листания.
 */
export function StoryInteractiveLayer(props: StoryInteractiveProps) {
  const t = useTranslations('Stories')
  const { poll, linkUrl, linkLabel, mentions, frame, preview = false } = props
  const link = safeStoryLink(linkUrl)
  const plan = planInteractive({
    hasPoll: !!poll,
    hasLink: !!link,
    mentionCount: mentions.length,
    frameHeight: frame.height,
  })
  const [tab, setTab] = useState<InteractiveKind>(plan.kinds[0] ?? 'poll')
  const tabsId = useId()
  if (plan.kinds.length === 0) return null
  const active = plan.kinds.includes(tab) ? tab : (plan.kinds[0] ?? 'poll')

  const blocks: Record<InteractiveKind, ReactNode> = {
    poll: poll && <StoryPollCard {...props} poll={poll} />,
    link: link && <StoryLinkSticker url={link} label={linkLabel} preview={preview} />,
    people: (
      <StoryPeopleChip
        count={mentions.length}
        preview={preview}
        onOpen={() => props.onExpand?.('people')}
      />
    ),
  }

  if (plan.mode === 'stack') {
    const chips = plan.kinds.filter((k) => k !== 'poll')
    return (
      <div className="flex flex-col gap-2" aria-label={t('interactiveLayer')} role="group">
        {blocks.poll}
        {chips.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {chips.map((k) => (
              <div key={k} className="min-w-0">
                {blocks[k]}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Вкладки: раскрыт один блок, остальные — переключателями под ним. Опрос по умолчанию.
  const TAB_ICON = { poll: BarChart3, link: Link2, people: Users } as const
  const TAB_LABEL = {
    poll: t('tabPoll'),
    link: t('tabLink'),
    people: t('tabPeople', { count: mentions.length }),
  }
  return (
    <div className="flex flex-col gap-2" aria-label={t('interactiveLayer')} role="group">
      <div
        role="tabpanel"
        id={`${tabsId}-${active}`}
        aria-labelledby={`${tabsId}-${active}-tab`}
        key={active}
        className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
      >
        {blocks[active]}
      </div>
      <div role="tablist" aria-label={t('interactiveLayer')} className="flex gap-1.5">
        {plan.kinds.map((k) => {
          const Icon = TAB_ICON[k]
          const selected = k === active
          return (
            <button
              key={k}
              type="button"
              role="tab"
              id={`${tabsId}-${k}-tab`}
              aria-selected={selected}
              aria-controls={`${tabsId}-${k}`}
              tabIndex={preview ? -1 : selected ? 0 : -1}
              disabled={preview}
              onClick={() => setTab(k)}
              onKeyDown={(e) => {
                // Стрелки внутри ряда вкладок — между вкладками, а не листание сторис.
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault()
                e.stopPropagation()
                const i = plan.kinds.indexOf(k)
                const next =
                  plan.kinds[
                    (i + (e.key === 'ArrowRight' ? 1 : -1) + plan.kinds.length) % plan.kinds.length
                  ]
                if (next) {
                  setTab(next)
                  document.getElementById(`${tabsId}-${next}-tab`)?.focus()
                }
              }}
              className={cn(
                'flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:cursor-default',
                selected
                  ? 'bg-white text-neutral-900'
                  : 'bg-black/45 text-white/85 ring-1 ring-white/15 hover:bg-black/60',
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{TAB_LABEL[k]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Компактный опрос: вопрос (до двух строк) и столько вариантов, сколько влезает в 30%
 * кадра; остальное — «Все варианты (N)» в раскрытой панели. Раскладка вариантов — рядом,
 * сеткой или столбиком (`pollShape`). Высота строки варианта одна до и после голоса:
 * результаты заливают строку, а не добавляют новую — карточка не прыгает.
 */
function StoryPollCard({
  poll,
  frame,
  preview = false,
  votingOptionId = null,
  onVote,
  onExpand,
}: StoryInteractiveProps & { poll: StoryPoll }) {
  const t = useTranslations('Stories')
  const texts = poll.options.map((o) => o.text)
  const shape = pollShape(texts)
  const visible = pollVisibleCount({
    options: texts,
    question: poll.question,
    frameWidth: frame.width,
    frameHeight: frame.height,
  })
  const percents = pollPercents(poll.options.map((o) => o.votes))
  const hidden = poll.options.length - visible

  return (
    <section
      aria-label={t('pollAria', { question: poll.question })}
      className="rounded-2xl bg-black/55 p-3 text-white ring-1 ring-white/15"
    >
      <p className="line-clamp-2 text-sm leading-5 font-semibold break-words" title={poll.question}>
        {poll.question}
      </p>
      {visible > 0 && (
        <PollOptions
          poll={poll}
          percents={percents}
          shape={shape}
          limit={visible}
          compact
          preview={preview}
          votingOptionId={votingOptionId}
          onVote={onVote}
          className="mt-2"
        />
      )}
      {hidden > 0 && (
        <button
          type="button"
          disabled={preview}
          onClick={() => onExpand?.('poll')}
          className="mt-1.5 flex h-9 w-full items-center justify-center gap-1 rounded-xl text-xs font-semibold text-white/85 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:cursor-default"
        >
          {visible === 0 ? t('pollAnswer') : t('pollAllOptions', { count: poll.options.length })}
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      )}
    </section>
  )
}

/**
 * Варианты опроса — в компактной карточке и в раскрытой панели. Один тап — голос; пока он
 * уходит, все варианты ждут (повторный запрос не уйдёт), у выбранного — индикатор. После
 * голоса строка заливается долей, справа — проценты, сумма которых ровно 100.
 */
function PollOptions({
  poll,
  percents,
  shape,
  limit,
  compact,
  preview,
  votingOptionId,
  onVote,
  tone = 'dark',
  className,
}: {
  poll: StoryPoll
  percents: number[]
  shape: PollShape
  limit: number
  compact: boolean
  preview: boolean
  votingOptionId: string | null
  onVote?: (optionId: string) => void
  /** dark — поверх кадра, light — на панели в цветах темы. */
  tone?: 'dark' | 'light'
  className?: string
}) {
  const t = useTranslations('Stories')
  const answered = poll.myOptionId !== null
  const busy = votingOptionId !== null
  return (
    <div
      role="group"
      aria-label={t('pollOptions')}
      aria-busy={busy || undefined}
      className={cn(
        'grid gap-1.5',
        shape === 'row'
          ? 'grid-cols-2'
          : shape === 'grid' && compact
            ? 'grid-cols-2'
            : 'grid-cols-1',
        className,
      )}
    >
      {poll.options.slice(0, limit).map((option, i) => {
        const share = percents[i] ?? 0
        const chosen = poll.myOptionId === option.id
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={chosen}
            aria-label={
              answered
                ? t('pollOptionResult', { option: option.text, percent: share })
                : option.text
            }
            title={option.text}
            disabled={preview || busy}
            onClick={() => onVote?.(option.id)}
            className={cn(
              'relative flex items-center overflow-hidden rounded-xl px-3 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default',
              compact ? 'h-10' : 'min-h-11 py-2.5',
              tone === 'dark'
                ? cn(
                    'focus-visible:ring-white/70',
                    chosen
                      ? 'bg-white/25 ring-1 ring-white/60'
                      : 'bg-white/12 enabled:hover:bg-white/20',
                  )
                : cn(
                    'focus-visible:ring-ring/50',
                    chosen
                      ? 'bg-primary/15 ring-1 ring-primary/50'
                      : 'bg-muted enabled:hover:bg-muted/70',
                  ),
            )}
          >
            {answered && (
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-0 left-0 transition-[width] duration-300 motion-reduce:transition-none',
                  tone === 'dark' ? 'bg-white/20' : 'bg-primary/15',
                )}
                style={{ width: `${share}%` }}
              />
            )}
            <span className="relative flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className={cn('min-w-0', compact ? 'truncate' : 'break-words')}>
                {option.text}
              </span>
              {votingOptionId === option.id ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                answered && (
                  <span className="shrink-0 text-xs font-semibold tabular-nums">{share}%</span>
                )
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Ссылка — компактный стикер по ширине подписи: «↗ Кремль». Светлый, чтобы отличаться от
 * тёмных системных кнопок и от отметок людей; длинная подпись — многоточием. Адрес — в
 * подсказке, открывается в новой вкладке без доступа к окну (noopener).
 */
function StoryLinkSticker({
  url,
  label,
  preview,
}: {
  url: URL
  label: string | null
  preview: boolean
}) {
  const t = useTranslations('Stories')
  const text = label ?? url.hostname.replace(/^www\./, '')
  const className =
    'inline-flex h-9 max-w-[min(100%,18rem)] items-center gap-1.5 rounded-xl bg-white/90 px-3 text-sm font-semibold text-neutral-900 shadow-sm transition-colors duration-150 hover:bg-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 focus-visible:outline-none'
  const body = (
    <>
      <Link2 className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="truncate">{text}</span>
      <ArrowUpRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
    </>
  )
  if (preview) return <span className={className}>{body}</span>
  return (
    <a
      href={url.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={url.href}
      aria-label={t('linkOpenAria', { label: text, host: url.hostname })}
      className={className}
    >
      {body}
    </a>
  )
}

/** «Упомянуты · N» — вместо россыпи плашек: тап открывает список людей. */
function StoryPeopleChip({
  count,
  preview,
  onOpen,
}: {
  count: number
  preview: boolean
  onOpen: () => void
}) {
  const t = useTranslations('Stories')
  return (
    <button
      type="button"
      disabled={preview}
      onClick={onOpen}
      className={cn(DARK_CHIP, 'disabled:cursor-default')}
    >
      <AtSign className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="truncate">{t('mentionedCount', { count })}</span>
    </button>
  )
}

/**
 * Раскрытый блок поверх кадра — панель снизу в цветах темы: полный опрос с результатами или
 * список отмеченных людей. Прокручивается только её содержимое. Фокус при открытии — в
 * панель, при закрытии — туда, откуда открыли. Esc и паузу кадра ведёт просмотрщик.
 */
export function StoryInteractiveSheet({
  what,
  poll,
  mentions,
  votingOptionId = null,
  onVote,
  onOpenProfile,
  onClose,
}: {
  what: StoryExpanded
  poll: StoryPoll | null
  mentions: readonly StoryMentionRef[]
  votingOptionId?: string | null
  onVote?: (optionId: string) => void
  onOpenProfile?: (userId: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    return () => opener?.focus({ preventScroll: true })
  }, [])

  const title = what === 'poll' ? (poll?.question ?? '') : t('mentionedTitle')

  return (
    <div className="absolute inset-0 flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-label={tCommon('close')}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/45 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[75%] flex-col rounded-t-2xl bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl outline-none animate-in fade-in-0 slide-in-from-bottom-6 duration-200 motion-reduce:animate-none"
      >
        <span
          aria-hidden
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
        />
        <header className="flex shrink-0 items-start gap-2 px-4 pt-2 pb-3">
          <h2
            id={titleId}
            className="min-w-0 flex-1 pt-1.5 text-base leading-snug font-semibold break-words"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon('close')}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-1">
          {what === 'poll' && poll ? (
            <>
              <PollOptions
                poll={poll}
                percents={pollPercents(poll.options.map((o) => o.votes))}
                shape="list"
                limit={poll.options.length}
                compact={false}
                preview={false}
                votingOptionId={votingOptionId}
                onVote={onVote}
                tone="light"
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {t('pollVotesTotal', { count: poll.totalVotes })}
              </p>
            </>
          ) : (
            <ul className="flex flex-col">
              {mentions.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => onOpenProfile?.(m.userId)}
                    aria-label={t('openProfileOf', { name: m.name })}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {initialsOf(m.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}
