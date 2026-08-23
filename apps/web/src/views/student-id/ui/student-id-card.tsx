'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { BadgeCheck, GraduationCap } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Badge } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import type { StudentIdCard as Card } from '../../../entities/student-id'

// Статус обучения → тон бейджа. Пустой статус у студента с билетом трактуем как «Активен».
type StatusTone = 'active' | 'leave' | 'inactive'
function statusMeta(status: string | null): { tone: StatusTone; raw: string | null } {
  if (!status || status === 'Обучающийся') return { tone: 'active', raw: status }
  if (status === 'Академический отпуск') return { tone: 'leave', raw: status }
  return { tone: 'inactive', raw: status }
}

// Визуальная «карта» цифрового студенческого: шапка вуза, фото, ФИО, статус и реквизиты.
// Используется и на своей карте, и в результате верификации сотрудником. Пустые поля скрываются.
export function StudentIdCardFace({ card, footer }: { card: Card; footer?: ReactNode }) {
  const t = useTranslations('StudentId')
  const fullName = [card.lastName, card.firstName, card.middleName].filter(Boolean).join(' ')
  const uniLabel = card.universityShort || card.university
  const status = statusMeta(card.academicStatus)

  // Реквизиты: только заполненные поля (без «—»). faculty — на всю ширину и с переносом.
  const rows: { label: string; value: string; wide?: boolean; mono?: boolean }[] = []
  if (card.faculty) rows.push({ label: t('faculty'), value: card.faculty, wide: true })
  if (card.group) rows.push({ label: t('group'), value: card.group })
  if (card.course != null) rows.push({ label: t('course'), value: String(card.course) })
  if (card.educationLevel) rows.push({ label: t('educationLevel'), value: card.educationLevel })
  if (card.studyForm) rows.push({ label: t('studyForm'), value: card.studyForm })
  if (card.studentCardNumber)
    rows.push({ label: t('cardNumber'), value: card.studentCardNumber, mono: true })
  if (card.graduationYear) rows.push({ label: t('validUntil'), value: String(card.graduationYear) })

  return (
    <div className="relative isolate overflow-hidden rounded-2xl border border-border bg-card">
      {/* Голографический блик поверх карты (анти-скриншот), не перехватывает клики. */}
      <div className="sh-holo pointer-events-none absolute inset-0 z-20" aria-hidden />

      {/* Шапка вуза + отметка официального билета StudentHub. */}
      <div className="relative flex items-center gap-2 bg-gradient-to-r from-primary to-primary/80 px-5 py-3 text-primary-foreground">
        <GraduationCap className="size-5 shrink-0" aria-hidden />
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold"
          title={card.university ?? ''}
        >
          {uniLabel ?? t('studentCard')}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">
          <BadgeCheck className="size-3.5" aria-hidden />
          StudentHub
        </span>
      </div>

      {/* Личность: крупное фото, ФИО, статус обучения. */}
      <div className="relative flex gap-4 p-5">
        <Avatar className="size-24 shrink-0 rounded-xl ring-2 ring-primary/15">
          <AvatarImage src={card.avatarUrl ?? undefined} alt="" className="object-cover" />
          <AvatarFallback className="rounded-xl text-xl">
            {card.firstName[0]}
            {card.lastName[0]}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight break-words">{fullName}</h2>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('studentCard')}
          </p>
          <div className="mt-2">
            <StatusBadge tone={status.tone} raw={status.raw} t={t} />
          </div>
        </div>
      </div>

      {/* Реквизиты — компактной сеткой, только заполненные. */}
      {rows.length > 0 && (
        <dl className="relative grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border px-5 py-4 text-sm">
          {rows.map((r) => (
            <div key={r.label} className={cn('min-w-0', r.wide && 'col-span-2')}>
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd
                className={cn(
                  'font-medium break-words',
                  r.mono && 'font-mono tabular-nums',
                  // faculty (wide) переносится целиком; узкие поля — максимум 2 строки.
                  !r.wide && 'line-clamp-2',
                )}
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {footer}
    </div>
  )
}

function StatusBadge({
  tone,
  raw,
  t,
}: {
  tone: StatusTone
  raw: string | null
  t: ReturnType<typeof useTranslations>
}) {
  if (tone === 'active') {
    return (
      <Badge variant="success" className="gap-1.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        {t('statusActive')}
      </Badge>
    )
  }
  return <Badge variant={tone === 'leave' ? 'warning' : 'secondary'}>{raw}</Badge>
}
