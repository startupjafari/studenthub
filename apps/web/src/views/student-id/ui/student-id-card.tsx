'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { GraduationCap } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import type { StudentIdCard as Card } from '../../../entities/student-id'

// Визуальная «карта» студенческого билета: шапка вуза, фото, ФИО и реквизиты.
// Используется и на своей карте, и в результате верификации сотрудником.
export function StudentIdCardFace({ card, footer }: { card: Card; footer?: ReactNode }) {
  const t = useTranslations('StudentId')
  const fullName = [card.lastName, card.firstName, card.middleName].filter(Boolean).join(' ')
  const years =
    card.enrollmentYear || card.graduationYear
      ? `${card.enrollmentYear ?? '—'} – ${card.graduationYear ?? '…'}`
      : null

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Шапка вуза */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary/80 px-5 py-3 text-primary-foreground">
        <GraduationCap className="size-5 shrink-0" aria-hidden />
        <span className="truncate text-sm font-semibold">
          {card.university ?? t('studentCard')}
        </span>
      </div>

      <div className="flex gap-4 p-5">
        <Avatar className="size-20 rounded-xl">
          <AvatarImage src={card.avatarUrl ?? undefined} alt="" />
          <AvatarFallback className="rounded-xl text-lg">
            {card.firstName[0]}
            {card.lastName[0]}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">{fullName}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('studentCard')}</p>
          {card.studentCardNumber && (
            <p className="mt-1 font-mono text-sm tabular-nums">№ {card.studentCardNumber}</p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border px-5 py-4 text-sm">
        <Field label={t('faculty')} value={card.faculty} />
        <Field label={t('group')} value={card.group} />
        <Field label={t('educationLevel')} value={card.educationLevel} />
        <Field label={t('studyForm')} value={card.studyForm} />
        {years && <Field label={t('years')} value={years} />}
        <Field label={t('status')} value={card.academicStatus} />
      </dl>

      {footer}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value ?? '—'}</dd>
    </div>
  )
}
