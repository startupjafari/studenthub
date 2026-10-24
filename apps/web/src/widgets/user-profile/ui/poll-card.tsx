'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Check, Clock, EyeOff, ListChecks, RotateCcw, Trash2, Users } from 'lucide-react'
import {
  cancelPollVote,
  deletePoll,
  pollKeys,
  votePoll,
  type PollView,
} from '../../../entities/poll'
import { Badge, Button, Card, CardContent, Progress, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Props {
  poll: PollView
  isOwner: boolean
  // Модератор scope снимает чужой опрос (пункт «Удалить (модерация)»; решает сервер).
  canModerate?: boolean
}

// Карточка опроса во вкладке профиля. Автора на карточке нет: вкладка уже внутри его профиля,
// и одинаковые аватар с именем на каждой карточке были шумом. Вместо них сверху — то, что
// нужно, чтобы решить, голосовать ли: статус, сколько осталось и правила опроса.
//
// Автор видит итоги сразу (свои результаты ему важнее формы голосования) и может перейти к
// голосованию кнопкой в подвале; остальные сначала голосуют, итоги — по настройке опроса.
export function PollCard({ poll, isOwner, canModerate = false }: Props) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [selected, setSelected] = useState<string[]>([])
  const [ownerVoting, setOwnerVoting] = useState(false)
  // Полосы итогов растут от нуля после первого кадра: на первом рендере их ширина 0,
  // и переход до доли виден как «оживление данных», а не как готовая картинка.
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: pollKeys.byUser(poll.author.id) })
    void qc.invalidateQueries({ queryKey: pollKeys.detail(poll.id) })
  }

  const voteMut = useMutation({
    mutationFn: (ids: string[]) => votePoll(poll.id, ids),
    onSuccess: () => {
      setOwnerVoting(false)
      invalidate()
    },
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
  const canVoteNow = !voted && poll.canVote
  const votingMode = canVoteNow && (!isOwner || ownerVoting)
  const draft = isOwner && poll.status === 'DRAFT'

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
    day: 'numeric',
    month: 'short',
  })
  const maxVotes = Math.max(0, ...poll.options.map((o) => o.votes))

  return (
    <Card className="group h-full transition-shadow hover:ring-ring/50">
      <CardContent className="flex flex-1 flex-col gap-4">
        {/* Статус и правила опроса — одной строкой мета-данных; дата и удаление справа. */}
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            {draft ? (
              <Badge variant="outline">{t('draft')}</Badge>
            ) : poll.closed ? (
              <Badge variant="secondary">{t('pollStatusClosed')}</Badge>
            ) : (
              <Badge variant="success">{t('pollStatusActive')}</Badge>
            )}
            {!poll.closed && daysLeft !== null && daysLeft > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                {t('pollDaysLeft', { days: daysLeft })}
              </span>
            )}
            {poll.anonymous && (
              <span className="inline-flex items-center gap-1">
                <EyeOff className="size-3.5" aria-hidden />
                {t('pollAnonymous')}
              </span>
            )}
            {poll.multiple && (
              <span className="inline-flex items-center gap-1">
                <ListChecks className="size-3.5" aria-hidden />
                {t('pollMultipleAnswers')}
              </span>
            )}
          </div>
          <time dateTime={poll.createdAt} className="shrink-0 pt-0.5 text-xs text-muted-foreground">
            {date}
          </time>
          {(isOwner || canModerate) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={isOwner ? t('delete') : t('deleteModeration')}
              title={isOwner ? undefined : t('deleteModeration')}
              className="-my-1 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
              onClick={() => {
                void confirm(
                  isOwner
                    ? { title: t('pollDeleteConfirm'), destructive: true }
                    : {
                        title: t('pollDeleteConfirm'),
                        description: t('moderationDeleteHint'),
                        confirmLabel: t('deleteModeration'),
                        destructive: true,
                      },
                ).then((ok) => {
                  if (ok) delMut.mutate()
                })
              }}
            >
              <Trash2 className="size-4 text-destructive" aria-hidden />
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold leading-snug">{poll.question}</h3>
          {votingMode && (
            <p className="text-xs text-muted-foreground">
              {poll.multiple ? t('pollPickMany') : t('pollPickOne')}
            </p>
          )}
        </div>

        {votingMode ? (
          <div
            role={poll.multiple ? 'group' : 'radiogroup'}
            aria-label={poll.question}
            className="flex flex-col gap-2"
          >
            {poll.options.map((o) => {
              const active = selected.includes(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  role={poll.multiple ? 'checkbox' : 'radio'}
                  aria-checked={active}
                  onClick={() => toggle(o.id)}
                  className={cn(
                    'flex min-h-10 items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
                    active
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-border hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center border border-input',
                      poll.multiple ? 'rounded-md' : 'rounded-full',
                      active && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {active && <Check className="size-3" aria-hidden />}
                  </span>
                  {o.text}
                </button>
              )
            })}
          </div>
        ) : poll.canSeeResults ? (
          // Итоги: подпись целиком (без обрезки), справа доля и число голосов, под ней полоса.
          // Лидер выделен цветом полосы и весом шрифта — и цифрой, не только цветом.
          <ul className="flex flex-col gap-3">
            {poll.options.map((o) => {
              const pct = poll.totalVotes > 0 ? Math.round((o.votes / poll.totalVotes) * 100) : 0
              const mine = poll.myVotes.includes(o.id)
              const leader = maxVotes > 0 && o.votes === maxVotes
              return (
                <li key={o.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span
                      className={cn(
                        'flex min-w-0 items-center gap-1.5',
                        leader && 'font-semibold',
                        mine && 'text-primary',
                      )}
                    >
                      {mine && <Check className="size-4 shrink-0" aria-label={t('pollYourVote')} />}
                      <span className="min-w-0 break-words">{o.text}</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                      <span className={cn('font-semibold', leader && 'text-primary')}>{pct}%</span>
                      <span className="text-xs text-muted-foreground">
                        {t('pollVotesCount', { count: o.votes })}
                      </span>
                    </span>
                  </div>
                  <Progress
                    value={grown ? pct : 0}
                    aria-label={`${o.text}: ${pct}%`}
                    // Полоса растёт за 500 мс — оживление данных (DESIGN_SYSTEM §7).
                    indicatorClassName={cn(
                      'duration-(--motion-large) motion-reduce:transition-none',
                      leader ? 'bg-primary' : 'bg-muted-foreground/40',
                    )}
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
            <EyeOff className="size-4 shrink-0" aria-hidden />
            {voted ? t('pollVotedHidden') : t('pollResultsHidden')}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Users className="size-3.5" aria-hidden />
            {t('pollParticipants', { count: poll.participants })}
          </span>
          {poll.multiple && (
            <span className="tabular-nums">{t('pollVotesCount', { count: poll.totalVotes })}</span>
          )}
          {/* Действия — справа в подвале. При голосовании главная кнопка крайняя справа,
              «К результатам» (у автора) — слева от неё. */}
          {votingMode ? (
            <div className="-my-1 ml-auto flex items-center gap-2">
              {isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOwnerVoting(false)}
                >
                  {t('pollShowResults')}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                loading={voteMut.isPending}
                disabled={selected.length === 0}
                onClick={() => voteMut.mutate(selected)}
              >
                {t('pollVote')}
              </Button>
            </div>
          ) : voted && poll.allowRevote && !poll.closed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-my-1 ml-auto"
              loading={cancelMut.isPending}
              onClick={() => cancelMut.mutate()}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t('pollCancelVote')}
            </Button>
          ) : isOwner && canVoteNow ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-my-1 ml-auto"
              onClick={() => setOwnerVoting(true)}
            >
              {t('pollVote')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
