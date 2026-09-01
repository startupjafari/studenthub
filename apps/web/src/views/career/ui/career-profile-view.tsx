'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import {
  CONSENT_FIELDS,
  EMPLOYMENT_TYPES,
  WORK_FORMATS,
  type ConsentField,
  type EmploymentStatus,
  type EmploymentType,
  type UpdateCareerProfileInput,
  type WorkFormat,
} from '@studenthub/shared-schemas'
import {
  careerProfileKeys,
  fetchMyCareerProfile,
  setCareerConsent,
  updateMyCareerProfile,
} from '../../../entities/career-profile'
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  PageHeader,
  PageLoader,
  Progress,
  SectionPanel,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Карьерный профиль студента.
 *
 * Экран строится вокруг одного вопроса: «что увидит работодатель». Поэтому переключатель
 * видимости стоит первым, согласия на чувствительные поля — отдельным блоком с явным
 * перечислением, а всё, что приходит из профиля вуза, показано, но не редактируется здесь.
 */
export function CareerProfileView() {
  const t = useTranslations('CareerProfile')
  const tCommon = useTranslations('Common')
  const queryClient = useQueryClient()

  const profile = useQuery({ queryKey: careerProfileKeys.mine(), queryFn: fetchMyCareerProfile })

  const save = useMutation({
    mutationFn: (input: UpdateCareerProfileInput) => updateMyCareerProfile(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(careerProfileKeys.mine(), updated)
      toast.success(t('saved'))
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  const consent = useMutation({
    mutationFn: (input: { field: ConsentField; granted: boolean }) => setCareerConsent(input),
    onSuccess: (updated) => queryClient.setQueryData(careerProfileKeys.mine(), updated),
    onError: (error) => toast.error(toApiError(error).message),
  })

  // Локальная копия редактируемых полей: сохранение по кнопке, а не на каждый символ.
  const [draft, setDraft] = useState<UpdateCareerProfileInput>({})
  useEffect(() => {
    if (!profile.data) return
    setDraft({
      employmentStatus: profile.data.employmentStatus,
      desiredPositions: profile.data.desiredPositions,
      employmentTypes: profile.data.employmentTypes,
      workFormats: profile.data.workFormats,
      relocationReady: profile.data.relocationReady,
      desiredSalaryMin: profile.data.desiredSalaryMin,
      desiredSalaryMax: profile.data.desiredSalaryMax,
      about: profile.data.about ?? undefined,
    })
  }, [profile.data])

  if (profile.isLoading || !profile.data) return <PageLoader label={tCommon('loading')} />

  const data = profile.data
  const visible = data.visibility === 'EMPLOYERS'
  const consentFor = (field: ConsentField) => data.consents.some((c) => c.field === field)

  // Ключи i18n перечислены явно: сборка вида t(`part.${x}`) запрещена (FRONTEND_RULES §10).
  const partLabel: Record<(typeof data.readiness.parts)[number]['key'], string> = {
    education: t('partEducation'),
    skills: t('partSkills'),
    portfolio: t('partPortfolio'),
    preferences: t('partPreferences'),
    about: t('partAbout'),
  }
  const consentLabel: Record<ConsentField, string> = {
    GPA: t('consentGpa'),
    PHONE: t('consentPhone'),
    EMAIL: t('consentEmail'),
  }
  const statusLabel: Record<EmploymentStatus, string> = {
    LOOKING: t('statusLooking'),
    OPEN: t('statusOpen'),
    NOT_LOOKING: t('statusNotLooking'),
  }
  const employmentLabel: Record<EmploymentType, string> = {
    INTERNSHIP: t('employmentInternship'),
    PART_TIME: t('employmentPartTime'),
    FULL_TIME: t('employmentFullTime'),
    CONTRACT: t('employmentContract'),
    FREELANCE: t('employmentFreelance'),
  }
  const formatLabel: Record<WorkFormat, string> = {
    ONSITE: t('formatOnsite'),
    HYBRID: t('formatHybrid'),
    REMOTE: t('formatRemote'),
  }
  // Без `min-h-0`: экран прокручивается целиком, внутреннего скролл-контейнера тут нет.
  // С `min-h-0` колонка ужималась до высоты `main`, а карточки с `overflow-hidden`
  // резали содержимое — список уходил за нижнюю границу без всякой прокрутки.

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Видимость — первое решение на экране: без него всё остальное не имеет эффекта. */}
      <section
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4',
          visible ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {visible ? (
              <Eye className="size-5" aria-hidden />
            ) : (
              <EyeOff className="size-5" aria-hidden />
            )}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-semibold">
              {visible ? t('visibleTitle') : t('hiddenTitle')}
            </p>
            <p className="text-sm text-muted-foreground">
              {visible ? t('visibleText') : t('hiddenText')}
            </p>
          </div>
        </div>
        <Button
          variant={visible ? 'outline' : 'default'}
          size="sm"
          loading={save.isPending}
          onClick={() => save.mutate({ visibility: visible ? 'HIDDEN' : 'EMPLOYERS' })}
        >
          {visible ? t('hideProfile') : t('showProfile')}
        </Button>
      </section>

      {/* Готовность: не оценка человека, а перечень незаполненного. */}
      <SectionPanel
        title={t('readiness')}
        subtitle={t('readinessHint')}
        actions={
          <span className="text-xl font-semibold tabular-nums">{data.readiness.score}%</span>
        }
      >
        <div className="flex flex-col gap-3">
          <Progress value={data.readiness.score} />
          <ul className="flex flex-wrap gap-2">
            {data.readiness.parts.map((part) => (
              <li key={part.key}>
                <Badge variant={part.earned === part.max ? 'secondary' : 'outline'}>
                  {partLabel[part.key]} {part.earned}/{part.max}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </SectionPanel>

      {/* Согласия: по умолчанию всё закрыто, и это должно быть видно. */}
      <SectionPanel
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t('consentsTitle')}
          </span>
        }
        subtitle={t('consentsText')}
      >
        <ul className="flex flex-col gap-2">
          {CONSENT_FIELDS.map((field) => (
            <li key={field} className="flex items-center gap-3">
              <Checkbox
                id={`consent-${field}`}
                checked={consentFor(field)}
                disabled={consent.isPending}
                onCheckedChange={(checked) => consent.mutate({ field, granted: checked === true })}
              />
              <Label htmlFor={`consent-${field}`} className="cursor-pointer font-normal">
                {consentLabel[field]}
              </Label>
            </li>
          ))}
        </ul>
      </SectionPanel>

      {/* Что ищет. */}
      <SectionPanel title={t('lookingTitle')} subtitle={t('lookingHint')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(['LOOKING', 'OPEN', 'NOT_LOOKING'] as EmploymentStatus[]).map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={draft.employmentStatus === status ? 'default' : 'outline'}
                onClick={() => setDraft((d) => ({ ...d, employmentStatus: status }))}
              >
                {statusLabel[status]}
              </Button>
            ))}
          </div>

          <MultiToggle
            label={t('employmentTypes')}
            options={EMPLOYMENT_TYPES}
            selected={draft.employmentTypes ?? []}
            onToggle={(value) =>
              setDraft((d) => ({ ...d, employmentTypes: toggle(d.employmentTypes, value) }))
            }
            render={(v) => employmentLabel[v]}
          />

          <MultiToggle
            label={t('workFormats')}
            options={WORK_FORMATS}
            selected={draft.workFormats ?? []}
            onToggle={(value) =>
              setDraft((d) => ({ ...d, workFormats: toggle(d.workFormats, value) }))
            }
            render={(v) => formatLabel[v]}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="salaryMin">{t('salaryFrom')}</Label>
              <Input
                id="salaryMin"
                type="number"
                inputMode="numeric"
                value={draft.desiredSalaryMin ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    desiredSalaryMin: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="salaryMax">{t('salaryTo')}</Label>
              <Input
                id="salaryMax"
                type="number"
                inputMode="numeric"
                value={draft.desiredSalaryMax ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    desiredSalaryMax: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="about">{t('about')}</Label>
            <Textarea
              id="about"
              rows={5}
              value={draft.about ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, about: e.target.value }))}
              placeholder={t('aboutPlaceholder')}
            />
          </div>

          <Button
            className="self-start"
            loading={save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {t('save')}
          </Button>
        </div>
      </SectionPanel>

      {/* Данные из профиля вуза: показываем, но не редактируем — иначе будет два источника. */}
      <SectionPanel
        title={t('inheritedTitle')}
        subtitle={t('inheritedText')}
        className="border-dashed"
      >
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={t('university')} value={data.inherited.universityName} />
          <Row label={t('specialty')} value={data.inherited.specialty} />
          <Row
            label={t('course')}
            value={data.inherited.course ? String(data.inherited.course) : null}
          />
          <Row
            label={t('skillsCount')}
            value={data.inherited.skills.length ? data.inherited.skills.join(', ') : null}
          />
          <Row label={t('portfolioCount')} value={String(data.inherited.portfolioCount)} />
        </dl>
      </SectionPanel>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations('CareerProfile')
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate', !value && 'text-muted-foreground')}>{value ?? t('empty')}</dd>
    </div>
  )
}

function MultiToggle<T extends string>({
  label,
  options,
  selected,
  onToggle,
  render,
}: {
  label: string
  options: readonly T[]
  selected: readonly T[]
  onToggle: (value: T) => void
  render: (value: T) => string
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={selected.includes(option) ? 'default' : 'outline'}
            onClick={() => onToggle(option)}
          >
            {render(option)}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** Добавить или убрать значение из набора. */
function toggle<T extends string>(list: readonly T[] | undefined, value: T): T[] {
  const current = list ?? []
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}
