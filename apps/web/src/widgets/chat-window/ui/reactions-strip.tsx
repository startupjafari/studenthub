'use client'

import { useTranslations } from 'next-intl'
import type { MessageReaction } from '../../../entities/chat'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/**
 * Сколько всего реакций под сообщением, чтобы вместо числа показать лица поставивших.
 * Как в Telegram: при трёх и меньше видно, КТО отреагировал, — число «1» ничего не говорит.
 */
const MAX_FACES = 3

/** Реакция по умолчанию: двойной клик или двойное касание по сообщению. */
export const DEFAULT_REACTION = '🔥'

export interface ReactionGroup {
  emoji: string
  count: number
  mine: boolean
  users: MessageReaction['user'][]
}

/** Чипы в порядке первого появления эмодзи — порядок не прыгает от новых голосов. */
export function groupReactions(
  reactions: readonly MessageReaction[],
  myId: string | undefined,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>()
  for (const r of reactions) {
    const g = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, users: [] }
    g.count += 1
    g.users.push(r.user)
    if (r.userId === myId) g.mine = true
    groups.set(r.emoji, g)
  }
  return [...groups.values()]
}

export const reactorName = (u: MessageReaction['user']): string =>
  `${u.lastName} ${u.firstName}`.trim()

const initials = (u: MessageReaction['user']): string =>
  (u.lastName[0] ?? '') + (u.firstName[0] ?? '')

/**
 * Реакции под пузырём в духе Telegram: чип «эмодзи + число», при малом числе реакций —
 * «эмодзи + лица». Своя реакция — залитый чип. Клик — поставить или снять, правый клик
 * (и клавиша меню) — список поставивших с этим эмодзи.
 */
export function ReactionsStrip({
  reactions,
  myId,
  ownBubble,
  onToggle,
  onShowReactors,
  className,
}: {
  reactions: readonly MessageReaction[]
  myId: string | undefined
  /** Чипы на своём (залитом primary) пузыре — инвертированная палитра. */
  ownBubble: boolean
  onToggle: (emoji: string) => void
  onShowReactors?: (emoji: string) => void
  className?: string
}) {
  const t = useTranslations('Chats')
  if (reactions.length === 0) return null
  const groups = groupReactions(reactions, myId)
  const withFaces = reactions.length <= MAX_FACES

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          aria-pressed={g.mine}
          aria-label={t('tgBehavior.reactionChip', { emoji: g.emoji, count: g.count })}
          title={g.users.map(reactorName).join(', ')}
          onClick={() => onToggle(g.emoji)}
          onContextMenu={
            onShowReactors
              ? (e) => {
                  e.preventDefault()
                  // Меню сообщения на той же строке открываться не должно.
                  e.stopPropagation()
                  onShowReactors(g.emoji)
                }
              : undefined
          }
          // Двойной клик по чипу — два переключения, а не реакция по умолчанию на сообщение.
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn(
            'flex h-[22px] items-center gap-1 rounded-full pr-1.5 pl-1 text-xs leading-none font-semibold tabular-nums outline-none duration-(--motion-control) animate-in fade-in-0 zoom-in-90 focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-95',
            ownBubble
              ? g.mine
                ? 'bg-primary-foreground text-primary hover:bg-primary-foreground/90'
                : 'bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25'
              : g.mine
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-primary/10 text-primary hover:bg-primary/20',
          )}
        >
          <span className="text-sm leading-none" aria-hidden>
            {g.emoji}
          </span>
          {withFaces ? (
            <span className="flex -space-x-1.5" aria-hidden>
              {g.users.map((u) => (
                <Avatar
                  key={u.id}
                  className={cn(
                    'size-[18px] ring-[1.5px]',
                    // Кольцо — цвета чипа под ним: лица «врезаны» друг в друга, а не слиплись.
                    ownBubble
                      ? g.mine
                        ? 'ring-primary-foreground'
                        : 'ring-primary'
                      : g.mine
                        ? 'ring-primary'
                        : 'ring-muted',
                  )}
                >
                  {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[0.5rem]">{initials(u)}</AvatarFallback>
                </Avatar>
              ))}
            </span>
          ) : (
            // Новое число въезжает снизу — как счётчик в Telegram, без перерисовки чипа.
            <span
              key={g.count}
              className="duration-(--motion-control) animate-in fade-in-0 slide-in-from-bottom-1"
              aria-hidden
            >
              {g.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
