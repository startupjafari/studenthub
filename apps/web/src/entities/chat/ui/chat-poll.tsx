'use client'

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BarChart3, Check } from 'lucide-react'
import { chatKeys, fetchPollResults, votePollRequest } from '../api/chat-api'
import type { ChatPoll } from '../model/types'
import { cn } from '../../../shared/lib/utils'

// Детерминированный порядок при randomOrder: сортируем по хэшу (seed + optionId).
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// Опрос в чате (§38–39): вопрос + варианты со шкалами, голосование/переголосование/снятие.
// Статика приходит на сообщении (poll); результаты (счётчики + мой голос) — отдельным запросом.
export function ChatPollView({
  poll,
  mine,
  viewerId,
}: {
  poll: ChatPoll
  mine: boolean
  // §39: случайный порядок — персональный (seed включает id смотрящего).
  viewerId?: string
}) {
  const t = useTranslations('Chats')
  const qc = useQueryClient()
  const results = useQuery({
    queryKey: chatKeys.poll(poll.id),
    queryFn: () => fetchPollResults(poll.id),
  })
  const vote = useMutation({
    mutationFn: (optionIds: string[]) => votePollRequest(poll.id, optionIds),
    onSuccess: (data) => qc.setQueryData(chatKeys.poll(poll.id), data),
  })

  const r = results.data
  const my = useMemo(() => new Set(r?.myOptionIds ?? []), [r?.myOptionIds])
  const total = r?.totalVotes ?? 0
  const closed = r?.closed ?? poll.closed

  const options = useMemo(() => {
    const opts = [...poll.options]
    if (poll.randomOrder) {
      const seed = poll.id + (viewerId ?? '')
      opts.sort((a, b) => hash(seed + a.id) - hash(seed + b.id))
    } else opts.sort((a, b) => a.order - b.order)
    return opts
  }, [poll.options, poll.randomOrder, poll.id, viewerId])

  function toggle(optionId: string): void {
    if (closed || vote.isPending) return
    if (poll.multiple) {
      const next = new Set(my)
      if (next.has(optionId)) next.delete(optionId)
      else next.add(optionId)
      vote.mutate([...next])
    } else if (my.has(optionId)) {
      if (poll.allowRevote) vote.mutate([]) // повторный клик по выбранному — снять голос
    } else {
      vote.mutate([optionId])
    }
  }

  const tags = [
    poll.anonymous ? t('pollAnonymous') : null,
    poll.multiple ? t('pollMultiple') : null,
    closed ? t('pollClosed') : null,
  ].filter(Boolean)

  return (
    <div className="min-w-[14rem] max-w-full">
      <p className="flex items-start gap-1.5 text-sm font-semibold">
        <BarChart3 className="mt-0.5 size-4 shrink-0 opacity-80" aria-hidden />
        <span className="break-words">{poll.question}</span>
      </p>
      {tags.length > 0 && (
        <p className="mb-1.5 mt-0.5 pl-6 text-[0.65rem] uppercase tracking-wide opacity-60">
          {tags.join(' · ')}
        </p>
      )}
      <div className="mt-1.5 space-y-1.5">
        {options.map((o) => {
          const votes = r?.options.find((x) => x.id === o.id)?.votes ?? 0
          const pct = total > 0 ? Math.round((votes / total) * 100) : 0
          const selected = my.has(o.id)
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              disabled={closed || vote.isPending}
              className={cn(
                'relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default',
                mine ? 'bg-primary-foreground/10' : 'bg-background/60',
              )}
            >
              {/* Шкала-заливка по проценту. */}
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-lg transition-[width] duration-500',
                  mine ? 'bg-primary-foreground/20' : 'bg-primary/15',
                )}
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span
                className={cn(
                  'relative z-10 flex size-4 shrink-0 items-center justify-center rounded-full border',
                  poll.multiple ? 'rounded-[0.3rem]' : 'rounded-full',
                  selected ? 'border-current bg-current/20' : 'border-current/40',
                )}
              >
                {selected && <Check className="size-3" aria-hidden />}
              </span>
              <span className="relative z-10 min-w-0 flex-1 break-words">{o.text}</span>
              <span className="relative z-10 shrink-0 text-xs tabular-nums opacity-70">{pct}%</span>
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 text-xs opacity-70">{t('pollVotes', { count: total })}</p>
    </div>
  )
}
