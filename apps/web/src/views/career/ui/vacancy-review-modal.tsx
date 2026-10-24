'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { EmploymentType, ExperienceLevel, WorkFormat } from '@studenthub/shared-schemas'
import type { VacancyReviewRow } from '../../../entities/vacancy'
import { Badge, Button, Modal } from '../../../shared/ui'
import { salaryText } from '../lib/salary-text'

interface VacancyReviewModalProps {
  row: VacancyReviewRow
  /** Кнопки решения — только у тех, кто решает (декан очередь лишь смотрит). */
  canDecide: boolean
  busy: boolean
  onApprove: () => void
  /** Отказ по ожидающей заявке и снятие уже одобренной — оба с причиной. */
  onReject: () => void
  onClose: () => void
}

/**
 * Карточка вакансии в очереди модерации.
 *
 * Строка таблицы вмещает название, компанию и описание, а решают по условиям: зарплата,
 * город, формат, навыки, срок отклика. Без них модератор одобрял вакансию вслепую.
 */
export function VacancyReviewModal({
  row,
  canDecide,
  busy,
  onApprove,
  onReject,
  onClose,
}: VacancyReviewModalProps) {
  const t = useTranslations('CareerAdmin')
  const tv = useTranslations('Vacancies')
  const te = useTranslations('EmployerVacancies')
  const locale = useLocale()
  const { vacancy } = row

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
  const experienceLabel: Record<ExperienceLevel, string> = {
    NO_EXPERIENCE: te('experienceNone'),
    INTERN: te('experienceIntern'),
    JUNIOR: te('experienceJunior'),
    MIDDLE: te('experienceMiddle'),
  }

  const salary = salaryText(vacancy, { from: tv('salaryFrom'), to: tv('salaryTo') }, locale)
  const deadline = vacancy.deadline
    ? new Date(vacancy.deadline).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  return (
    <Modal onClose={onClose} title={vacancy.title} size="xl">
      <div className="flex flex-col gap-5">
        <p className="font-medium">{vacancy.company.name}</p>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Fact label={tv('colFormat')}>
            {employmentLabel[vacancy.employmentType]} · {formatLabel[vacancy.workFormat]}
          </Fact>
          <Fact label={t('reviewExperience')}>{experienceLabel[vacancy.experienceLevel]}</Fact>
          <Fact label={tv('colCity')}>{vacancy.city ?? t('reviewNotSet')}</Fact>
          <Fact label={tv('colSalary')}>{salary ?? t('reviewNotSet')}</Fact>
          <Fact label={t('reviewDeadline')}>{deadline ?? t('reviewNotSet')}</Fact>
          {vacancy.languages.length > 0 && (
            <Fact label={t('reviewLanguages')}>{vacancy.languages.join(', ')}</Fact>
          )}
        </dl>

        {vacancy.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {vacancy.skills.map((skill) => (
              <Badge key={skill} variant="outline">
                {skill}
              </Badge>
            ))}
          </div>
        )}

        {/* Описание — простой текст из формы компании: переносы строк сохраняем, разметку нет. */}
        <p className="text-sm whitespace-pre-line">{vacancy.description}</p>

        {row.reason && (
          <p className="text-sm text-muted-foreground">
            {t('decisionReason')}: {row.reason}
          </p>
        )}

        {canDecide && (row.status === 'PENDING' || row.status === 'APPROVED') && (
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            {row.status === 'PENDING' ? (
              <>
                <Button variant="outline" disabled={busy} onClick={onReject}>
                  {t('reject')}
                </Button>
                <Button disabled={busy} onClick={onApprove}>
                  {t('approve')}
                </Button>
              </>
            ) : (
              <Button variant="outline" disabled={busy} onClick={onReject}>
                {t('unpublish')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
