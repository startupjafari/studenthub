'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  DoorClosed,
  Rocket,
  ScrollText,
  UserPlus,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { OnboardingStep } from '@studenthub/shared-schemas'
import {
  confirmOnboardingProfile,
  fetchOnboardingState,
  launchUniversity,
  onboardingKeys,
  skipOnboardingStep,
  type OnboardingState,
  type OnboardingStepState,
} from '../../../entities/onboarding'
import { Button, Card, EmptyState, PageHeader, PageLoader } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { StepBody } from './step-body'

/**
 * Иконка и полный раздел каждого шага.
 *
 * Мастер не заменяет управление структурой: у факультетов, групп и аудиторий есть свои
 * экраны со всем, что там бывает, и они не должны существовать в двух версиях. Здесь
 * заводят самое необходимое и идут дальше, а ссылка ведёт туда, где делают остальное.
 *
 * `profile` и `launch` ссылки не имеют: реквизиты вуза правит платформа, а запуск — это
 * и есть последний экран мастера.
 */
const STEP_META: Record<OnboardingStep, { icon: LucideIcon; href?: string }> = {
  profile: { icon: Building2 },
  faculties: { icon: Building2, href: '/university-admin/faculties' },
  specialties: { icon: ScrollText, href: '/university-admin/specialties' },
  groups: { icon: Users, href: '/university-admin/groups' },
  rooms: { icon: DoorClosed, href: '/university-admin/rooms' },
  terms: { icon: CalendarDays, href: '/university-admin/courses' },
  subjects: { icon: BookOpen, href: '/university-admin/courses' },
  deans: { icon: UserPlus, href: '/university-admin/invites' },
  launch: { icon: Rocket },
}

/**
 * Мастер первичной настройки вуза.
 *
 * Открыт один шаг за раз, и это не украшение: девять развёрнутых карточек читаются как
 * список дел на неделю, а мастер существует ровно затем, чтобы человек не выбирал,
 * с чего начать. Пройденные шаги сворачиваются с галочкой и остаются доступными —
 * вернуться к факультетам после групп нужно почти всегда.
 *
 * Пройденность считает сервер по самим данным: удалили последний факультет — шаг снова
 * не пройден, и запуск снова заблокирован. Ничего «отмеченного руками» здесь нет.
 */
export function SetupView() {
  const t = useTranslations('Setup')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const state = useQuery({ queryKey: onboardingKeys.state(), queryFn: fetchOnboardingState })
  const [open, setOpen] = useState<OnboardingStep | null>(null)

  // Открываем шаг, на котором человек остановился. Только при первой загрузке: после
  // добавления факультета сервер сдвинет currentStep, и карточка уехала бы из-под рук
  // ровно в тот момент, когда в неё вводят второй факультет.
  useEffect(() => {
    if (state.data && open === null) setOpen(state.data.currentStep)
  }, [state.data, open])

  const onDone = (next: OnboardingState) => {
    qc.setQueryData(onboardingKeys.state(), next)
    void qc.invalidateQueries({ queryKey: onboardingKeys.state() })
  }
  const onFail = (e: unknown) =>
    toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))

  const confirmMut = useMutation({ mutationFn: confirmOnboardingProfile, onSuccess: onDone, onError: onFail }) // prettier-ignore
  const skipMut = useMutation({
    mutationFn: (step: OnboardingStep) => skipOnboardingStep({ step }),
    onSuccess: onDone,
    onError: onFail,
  })
  const launchMut = useMutation({
    mutationFn: launchUniversity,
    onSuccess: (next) => {
      onDone(next)
      toast.success(t('launched'))
    },
    onError: onFail,
  })

  if (state.isLoading) return <PageLoader label={t('title')} />
  if (state.isError || !state.data) return <EmptyState title={tErr('INTERNAL_ERROR')} />

  const data = state.data
  const doneCount = data.steps.filter((s) => s.done || s.skipped).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { university: data.university.name })}
      />

      {/* Полоса прогресса: сколько шагов позади из девяти. Число рядом обязательно —
          по одной полоске «почти всё» и «половина» различить нельзя. */}
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${(doneCount / data.steps.length) * 100}%` }}
          />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {t('progress', { done: doneCount, total: data.steps.length })}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {data.steps.map((step, index) => (
          <StepCard
            key={step.step}
            step={step}
            index={index}
            open={open === step.step}
            onToggle={() => setOpen(open === step.step ? null : step.step)}
            state={data}
            onDone={onDone}
            onConfirmProfile={() => confirmMut.mutate()}
            confirming={confirmMut.isPending}
            onSkip={() => skipMut.mutate(step.step)}
            skipping={skipMut.isPending}
            onLaunch={() => launchMut.mutate()}
            launching={launchMut.isPending}
          />
        ))}
      </div>
    </div>
  )
}

interface StepCardProps {
  step: OnboardingStepState
  index: number
  open: boolean
  onToggle: () => void
  state: OnboardingState
  onDone: (next: OnboardingState) => void
  onConfirmProfile: () => void
  confirming: boolean
  onSkip: () => void
  skipping: boolean
  onLaunch: () => void
  launching: boolean
}

function StepCard(props: StepCardProps) {
  const { step, index, open, onToggle } = props
  const t = useTranslations('Setup')
  const meta = STEP_META[step.step]
  const Icon = meta.icon

  return (
    <Card className={cn('gap-0 overflow-hidden p-0', open && 'ring-1 ring-primary/30')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
      >
        {/* Галочка вместо номера у пройденного шага: номер сообщает «где я», галочка —
            «здесь готово», и одновременно нужно только одно из двух. */}
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl border text-sm font-semibold tabular-nums',
            step.done
              ? 'border-success/30 bg-success/10 text-success'
              : step.skipped
                ? 'border-border bg-muted text-muted-foreground'
                : 'border-border bg-background',
          )}
        >
          {step.done ? <Check className="size-4" aria-hidden /> : index + 1}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-medium">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{t(`step.${step.step}.title`)}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {step.skipped
              ? t('skipped')
              : step.count !== null && step.count > 0
                ? t('counted', { n: step.count })
                : t(`step.${step.step}.short`)}
          </span>
        </span>

        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-4">
          {/* Подсказка «зачем» стоит выше формы, а не под ней: её читают до того, как
              начинают вводить, и после — уже незачем. */}
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(`step.${step.step}.hint`)}
          </p>

          <StepBody {...props} />

          <div className="flex flex-wrap items-center gap-2">
            {meta.href && (
              <Button asChild variant="outline" size="sm">
                <Link href={meta.href}>
                  {t('openSection')}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            )}
            {step.skippable && !step.skipped && !step.done && (
              <Button
                variant="ghost"
                size="sm"
                loading={props.skipping}
                onClick={props.onSkip}
                className="text-muted-foreground"
              >
                {t('skip')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
