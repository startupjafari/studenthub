'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Briefcase, MapPin, Search } from 'lucide-react'
import {
  EMPLOYMENT_TYPES,
  WORK_FORMATS,
  type EmploymentType,
  type WorkFormat,
} from '@studenthub/shared-schemas'
import { searchVacancies, vacancyKeys, type Vacancy } from '../../../entities/vacancy'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  TablePagination,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/**
 * Витрина вакансий для студента.
 *
 * Процент совпадения показывается, но НИЧЕГО не скрывает: он влияет только на то, что
 * студент видит первым, а не на состав списка. Спрятать вакансию из-за низкого процента
 * значило бы принять решение за человека на основании неполных данных.
 */
export function CareerVacanciesView() {
  const t = useTranslations('Vacancies')
  const tErr = useTranslations('Errors')
  const [search, setSearch] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType | null>(null)
  const [workFormat, setWorkFormat] = useState<WorkFormat | null>(null)
  const [page, setPage] = useState(1)
  const limit = 20

  const params = {
    page,
    limit,
    ...(search ? { search } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(workFormat ? { workFormat } : {}),
  }

  const query = useQuery({
    queryKey: vacancyKeys.search(params),
    queryFn: () => searchVacancies(params),
  })

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

  const rows = query.data?.items ?? []

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {EMPLOYMENT_TYPES.map((type) => (
            <Button
              key={type}
              size="sm"
              variant={employmentType === type ? 'default' : 'outline'}
              onClick={() => {
                setEmploymentType(employmentType === type ? null : type)
                setPage(1)
              }}
            >
              {employmentLabel[type]}
            </Button>
          ))}
          <span className="w-px self-stretch bg-border" aria-hidden />
          {WORK_FORMATS.map((format) => (
            <Button
              key={format}
              size="sm"
              variant={workFormat === format ? 'default' : 'outline'}
              onClick={() => {
                setWorkFormat(workFormat === format ? null : format)
                setPage(1)
              }}
            >
              {formatLabel[format]}
            </Button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['70%', '52%', '61%'].map((w) => (
            <li key={w} className="rounded-xl border border-border p-4">
              <Skeleton className="h-4 rounded-md" style={{ width: w }} />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr('INTERNAL_ERROR')} description={tErr('retryHint')} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((vacancy) => (
              <VacancyCard
                key={vacancy.id}
                vacancy={vacancy}
                employmentLabel={employmentLabel}
                formatLabel={formatLabel}
              />
            ))}
          </ul>
          <TablePagination
            page={page}
            limit={limit}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}

function VacancyCard({
  vacancy,
  employmentLabel,
  formatLabel,
}: {
  vacancy: Vacancy
  employmentLabel: Record<EmploymentType, string>
  formatLabel: Record<WorkFormat, string>
}) {
  const t = useTranslations('Vacancies')
  const locale = useLocale()
  const match = vacancy.match
  const salary = salaryText(vacancy, { from: t('salaryFrom'), to: t('salaryTo') }, locale)

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold">{vacancy.title}</p>
          <p className="text-sm text-muted-foreground">{vacancy.company.name}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{employmentLabel[vacancy.employmentType]}</span>
            <span aria-hidden>·</span>
            <span>{formatLabel[vacancy.workFormat]}</span>
            {vacancy.city && (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {vacancy.city}
                </span>
              </>
            )}
          </div>
          {salary && <p className="text-sm font-medium">{salary}</p>}
        </div>

        {match && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                'text-lg font-semibold tabular-nums',
                match.score >= 70 ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {match.score}%
            </span>
            <span className="text-xs text-muted-foreground">{t('match')}</span>
          </div>
        )}
      </div>

      {vacancy.skills.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {vacancy.skills.map((skill) => {
            const matched = match?.matchedSkills.includes(skill)
            return (
              <li key={skill}>
                {/* Совпавшие навыки выделены: это и есть объяснение процента. */}
                <Badge variant={matched ? 'secondary' : 'outline'}>
                  {matched && <span aria-hidden>✓ </span>}
                  {skill}
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

/**
 * Строка зарплаты: вилка, «от» или «до» — смотря что указала компания.
 * Подписи приходят переведёнными: собирать их здесь означало бы хардкод текста (§10).
 */
function salaryText(
  vacancy: Vacancy,
  labels: { from: string; to: string },
  locale: string,
): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency: currency } = vacancy
  if (min == null && max == null) return null
  const unit = currency ?? ''
  const fmt = (n: number) => n.toLocaleString(locale)
  if (min != null && max != null) return `${fmt(min)} — ${fmt(max)} ${unit}`.trim()
  if (min != null) return `${labels.from} ${fmt(min)} ${unit}`.trim()
  return `${labels.to} ${fmt(max as number)} ${unit}`.trim()
}
