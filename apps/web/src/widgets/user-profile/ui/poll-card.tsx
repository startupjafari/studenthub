'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Check, RotateCcw, Trash2 } from 'lucide-react'
import {
  cancelPollVote,
  deletePoll,
  pollKeys,
  votePoll,
  type PollView,
} from '../../../entities/poll'
import { ProfileLink } from '../../../entities/user'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

function initials(a: { firstName: string; lastName: string }): string {
  return `${a.lastName[0] ?? ''}${a.firstName[0] ?? ''}`.toUpperCase()
}

interface Props {
  poll: PollView
  isOwner: boolean
}

export function PollCard({ poll, isOwner }: Props) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [selected, setSelected] = useState<string[]>([])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: pollKeys.byUser(poll.author.id) })
    void qc.invalidateQueries({ queryKey: pollKeys.detail(poll.id) })
  }

  const voteMut = useMutation({
    mutationFn: (ids: string[]) => votePoll(poll.id, ids),
    onSuccess: invalidate,
    onError: (e) => toast.error(tErr(errCode(e))),
  })
  const cancelMut = useMutation({
    mutationFn: () => cancelPollVote(poll.id),
    onSuccess: invalidate,
    onError: (e) => toast.error(tErr(errCode(e))),
  })
  const delMut = useMutation({
    mutationFn: () => deletePoll(poll.id),
    onSuccess: invalidate,
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const voted = poll.myVotes.length > 0
  const votingMode = !voted && poll.canVote

  function toggle(id: string) {
    if (poll.multiple) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    } else {
      setSelected([id])
    }
  }

  const daysLeft = poll.closesAt
    ? Math.ceil((new Date(poll.closesAt).getTime() - Date.now()) / 86_400_000)
    : null
  const date = new Date(poll.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  return (
    <Card
      className={cn(
        'group flex flex-col rounded-2xl transition-shadow hover:ring-ring/50',
        poll.closed && 'opacity-95',
      )}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {/* Автор + дата */}
        <div className="flex items-center gap-2">
          <ProfileLink userId={poll.author.id} className="shrink-0">
            <Avatar className="size-9">
              {poll.author.avatarUrl && <AvatarImage src={poll.author.avatarUrl} alt="" />}
              <AvatarFallback>{initials(poll.author)}</AvatarFallback>
            </Avatar>
          </ProfileLink>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              <ProfileLink userId={poll.author.id} className="hover:text-primary hover:underline">
                {poll.author.lastName} {poll.author.firstName}
              </ProfileLink>
            </p>
            <p className="text-xs text-muted-foreground">{date}</p>
          </div>
          {isOwner && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={t('delete')}
              className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => {
                void confirm({ title: t('pollDeleteConfirm'), destructive: true }).then((ok) => {
                  if (ok) delMut.mutate()
                })
              }}
            >
              <Trash2 className="size-4 text-destructive" aria-hidden />
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {isOwner && poll.status === 'DRAFT' && <Badge variant="secondary">{t('draft')}</Badge>}
            {poll.closed && <Badge variant="secondary">{t('pollClosed')}</Badge>}
            {poll.multiple && <Badge variant="outline">{t('pollMultiple')}</Badge>}
            {poll.anonymous && <Badge variant="outline">{t('pollAnonymous')}</Badge>}
          </div>
          <p className="text-base font-semibold leading-snug">{poll.question}</p>
        </div>

        {votingMode ? (
          <div className="flex flex-col gap-2">
            {poll.options.map((o) => {
              const active = selected.includes(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors',
                    active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center border border-input',
                      poll.multiple ? 'rounded' : 'rounded-full',
                      active && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {active && <Check className="size-3" aria-hidden />}
                  </span>
                  {o.text}
                </button>
              )
            })}
            <Button
              type="button"
              size="sm"
              className="w-fit"
              loading={voteMut.isPending}
              disabled={selected.length === 0}
              onClick={() => voteMut.mutate(selected)}
            >
              {t('pollVote')}
            </Button>
          </div>
        ) : poll.canSeeResults ? (
          // Результаты: процент показан ВНУТРИ прогресс-бара (компактно, без отдельной строки).
          <div className="flex flex-col gap-2">
            {poll.options.map((o) => {
              const pct = poll.totalVotes > 0 ? Math.round((o.votes / poll.totalVotes) * 100) : 0
              const mine = poll.myVotes.includes(o.id)
              return (
                <div
                  key={o.id}
                  className={cn(
                    'relative overflow-hidden rounded-xl border',
                    mine ? 'border-primary/40' : 'border-border',
                  )}
                  title={t('pollVotesCount', { count: o.votes })}
                >
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 transition-[width] duration-500 ease-out',
                      mine ? 'bg-primary/20' : 'bg-muted',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
                    <span
                      className={cn(
                        'flex min-w-0 items-center gap-1.5 truncate',
                        mine && 'font-semibold text-primary',
                      )}
                    >
                      {mine && <Check className="size-4 shrink-0" aria-hidden />}
                      <span className="truncate">{o.text}</span>
                    </span>
                    <span
                      className={cn('shrink-0 font-semibold tabular-nums', mine && 'text-primary')}
                    >
                      {pct}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="rounded-xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
            {voted ? t('pollVotedHidden') : t('pollResultsHidden')}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>{t('pollParticipants', { count: poll.participants })}</span>
          {poll.multiple && <span>· {t('pollVotesCount', { count: poll.totalVotes })}</span>}
          {poll.closed ? (
            <span>· {t('pollClosed')}</span>
          ) : daysLeft !== null && daysLeft > 0 ? (
            <span>· {t('pollDaysLeft', { days: daysLeft })}</span>
          ) : null}
          {voted && poll.allowRevote && !poll.closed && (
            <button
              type="button"
              onClick={() => cancelMut.mutate()}
              className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
            >
              <RotateCcw className="size-3" aria-hidden />
              {t('pollCancelVote')}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
