'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  VACANCY_REVIEWED_FIELDS,
  VacancyInputSchema,
  WORK_FORMATS,
  type EmploymentType,
  type ExperienceLevel,
  type UpdateVacancyInput,
  type VacancyInput,
  type WorkFormat,
} from '@studenthub/shared-schemas'
import {
  createVacancy,
  updateVacancy,
  vacancyKeys,
  type EmployerVacancy,
} from '../../../entities/vacancy'
import {
  Button,
  DatePicker,
  FieldError,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

const CURRENCIES = ['KZT', 'USD', 'EUR', 'RUB'] as const
type Currency = (typeof CURRENCIES)[number]
// «Без валюты» — отдельное значение селекта: пустую строку Radix Select не принимает.
const NO_CURRENCY = 'none'

const EXPERIENCE_KEY: Record<ExperienceLevel, string> = {
  NO_EXPERIENCE: 'experienceNone',
  INTERN: 'experienceIntern',
  JUNIOR: 'experienceJunior',
  MIDDLE: 'experienceMiddle',
}

interface Draft {
  title: string
  description: string
  employmentType: EmploymentType
  workFormat: WorkFormat
  experienceLevel: ExperienceLevel
  city: string
  salaryMin: string
  salaryMax: string
  salaryCurrency: Currency | typeof NO_CURRENCY
  skills: string
  languages: string
  deadline: string
}

function toDraft(v: EmployerVacancy | null): Draft {
  return {
    title: v?.title ?? '',
    description: v?.description ?? '',
    employmentType: v?.employmentType ?? 'INTERNSHIP',
    workFormat: v?.workFormat ?? 'ONSITE',
    experienceLevel: v?.experienceLevel ?? 'NO_EXPERIENCE',
    city: v?.city ?? '',
    salaryMin: v?.salaryMin != null ? String(v.salaryMin) : '',
    salaryMax: v?.salaryMax != null ? String(v.salaryMax) : '',
    salaryCurrency: (v?.salaryCurrency as Currency | null) ?? NO_CURRENCY,
    skills: (v?.skills ?? []).join(', '),
    languages: (v?.languages ?? []).join(', '),
    deadline: v?.deadline ? v.deadline.slice(0, 10) : '',
  }
}

const list = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const amount = (value: string): number | null => (value.trim() ? Number(value) : null)

/** Черновик формы → тело запроса в форме контракта (VacancyInput). */
function toInput(d: Draft): VacancyInput {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    employmentType: d.employmentType,
    workFormat: d.workFormat,
    experienceLevel: d.experienceLevel,
    // Пустой город — null: так правка стирает прежний город, undefined его бы не тронул.
    city: d.city.trim() || null,
    salaryMin: amount(d.salaryMin),
    salaryMax: amount(d.salaryMax),
    salaryCurrency: d.salaryCurrency === NO_CURRENCY ? null : d.salaryCurrency,
    skills: list(d.skills),
    languages: list(d.languages),
    // Срок — датой: отклики принимаются до конца выбранного дня.
    deadline: d.deadline ? new Date(`${d.deadline}T23:59:59`).toISOString() : null,
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Создание и правка вакансии компании.
 *
 * Правка того, что читает студент и одобрял вуз (VACANCY_REVIEWED_FIELDS), возвращает
 * одобренную вакансию на модерацию — сервер сбрасывает решения вузов. Форма говорит об этом
 * до сохранения, а не после: иначе вакансия молча пропадала бы с витрины.
 */
export function VacancyFormModal({
  vacancy,
  onClose,
}: {
  vacancy: EmployerVacancy | null
  onClose: () => void
}) {
  const t = useTranslations('EmployerVacancies')
  const tv = useTranslations('Vacancies')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [initial] = useState(() => toDraft(vacancy))
  const [draft, setDraft] = useState<Draft>(initial)
  const [submitted, setSubmitted] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const input = toInput(draft)
  const before = toInput(initial)
  // Поле изменено, если его тронули в форме и итоговое значение другое: «a,b» и «a, b» —
  // одно и то же, а нетронутый срок не пересчитывается из даты в другое время суток.
  const changed = (k: keyof VacancyInput): boolean =>
    draft[k] !== initial[k] && !same(input[k], before[k])
  const changedReviewed = VACANCY_REVIEWED_FIELDS.some(changed)
  const approved = vacancy?.reviews.some((r) => r.status === 'APPROVED') ?? false

  const errors = {
    title: input.title.length < 3 ? t('titleTooShort') : null,
    description: input.description.length < 30 ? t('descriptionTooShort') : null,
    salary:
      input.salaryMin != null && input.salaryMax != null && input.salaryMin > input.salaryMax
        ? t('salaryRange')
        : null,
  }
  const show = (key: keyof typeof errors): string | null => (submitted ? errors[key] : null)

  const save = useMutation({
    mutationFn: async () => {
      if (!vacancy) return createVacancy(input)
      // На сервер — только изменённые поля: частичная правка не трогает остальное.
      const diff = Object.fromEntries(
        (Object.keys(input) as (keyof VacancyInput)[]).filter(changed).map((k) => [k, input[k]]),
      ) as UpdateVacancyInput
      if (Object.keys(diff).length > 0) await updateVacancy(vacancy.id, diff)
      return null
    },
    onSuccess: async () => {
      toast.success(vacancy ? t('saved') : t('created'))
      await queryClient.invalidateQueries({ queryKey: vacancyKeys.all })
      onClose()
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  function onSubmit(): void {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    if (!VacancyInputSchema.safeParse(input).success) {
      toast.error(t('formInvalid'))
      return
    }
    save.mutate()
  }

  const employmentLabel: Record<EmploymentType, string> = {
    INTERNSHIP: tv('employmentInternship'),
    PART_TIME: tv('employmentPartTime'),
    FULL_TIME: tv('employmentFullTime'),
    CONTRACT: tv('employmentContract'),
    FREELANCE: tv('employmentFreelance'),
  }
  const formatLabel: Record<WorkFormat, string> = {
    ONSITE: tv('formatOnsite'),
    HYBRID: tv('formatHybrid'),
    REMOTE: tv('formatRemote'),
  }

  return (
    <Modal onClose={onClose} title={vacancy ? t('editTitle') : t('createTitle')} size="2xl">
      <div className="flex flex-col gap-4">
        {approved && changedReviewed && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {t('reReviewWarning')}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vacancy-title">{t('fieldTitle')}</Label>
          <Input
            id="vacancy-title"
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            aria-invalid={!!show('title')}
          />
          <FieldError>{show('title')}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vacancy-description">{t('fieldDescription')}</Label>
          <Textarea
            id="vacancy-description"
            rows={6}
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            aria-invalid={!!show('description')}
          />
          <FieldError>{show('description')}</FieldError>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t('fieldEmployment')}</Label>
            <Select
              value={draft.employmentType}
              onValueChange={(v) => set('employmentType', v as EmploymentType)}
            >
              <SelectTrigger aria-label={t('fieldEmployment')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {employmentLabel[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('fieldFormat')}</Label>
            <Select
              value={draft.workFormat}
              onValueChange={(v) => set('workFormat', v as WorkFormat)}
            >
              <SelectTrigger aria-label={t('fieldFormat')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_FORMATS.map((format) => (
                  <SelectItem key={format} value={format}>
                    {formatLabel[format]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('fieldExperience')}</Label>
            <Select
              value={draft.experienceLevel}
              onValueChange={(v) => set('experienceLevel', v as ExperienceLevel)}
            >
              <SelectTrigger aria-label={t('fieldExperience')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPERIENCE_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {t(EXPERIENCE_KEY[level])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_8rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vacancy-city">{t('fieldCity')}</Label>
            <Input
              id="vacancy-city"
              value={draft.city}
              onChange={(e) => set('city', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vacancy-salary-min">{t('fieldSalaryMin')}</Label>
            <Input
              id="vacancy-salary-min"
              inputMode="numeric"
              value={draft.salaryMin}
              onChange={(e) => set('salaryMin', e.target.value.replace(/\D/g, ''))}
              aria-invalid={!!show('salary')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vacancy-salary-max">{t('fieldSalaryMax')}</Label>
            <Input
              id="vacancy-salary-max"
              inputMode="numeric"
              value={draft.salaryMax}
              onChange={(e) => set('salaryMax', e.target.value.replace(/\D/g, ''))}
              aria-invalid={!!show('salary')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('fieldCurrency')}</Label>
            <Select
              value={draft.salaryCurrency}
              onValueChange={(v) => set('salaryCurrency', v as Draft['salaryCurrency'])}
            >
              <SelectTrigger aria-label={t('fieldCurrency')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CURRENCY}>—</SelectItem>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <FieldError>{show('salary')}</FieldError>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vacancy-skills">{t('fieldSkills')}</Label>
            <Input
              id="vacancy-skills"
              value={draft.skills}
              onChange={(e) => set('skills', e.target.value)}
              placeholder={t('commaHint')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vacancy-languages">{t('fieldLanguages')}</Label>
            <Input
              id="vacancy-languages"
              value={draft.languages}
              onChange={(e) => set('languages', e.target.value)}
              placeholder={t('commaHint')}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('fieldDeadline')}</Label>
          <DatePicker
            value={draft.deadline}
            onChange={(v) => set('deadline', v)}
            className="w-48"
            aria-label={t('fieldDeadline')}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={save.isPending}>
            {vacancy ? t('save') : t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
