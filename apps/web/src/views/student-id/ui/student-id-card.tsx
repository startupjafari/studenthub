'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BadgeCheck, GraduationCap } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Badge } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import type { StudentIdCard as Card } from '../../../entities/student-id'

// Справочные поля профиля хранятся кодами (`BACHELOR`, `FULL_TIME`, `GRANT`), но вуз мог
// заполнить их и готовой строкой на своём языке. Поэтому не собираем ключ из значения
// (запрещено, FRONTEND_RULES §10), а держим явные таблицы: код известен — показываем
// перевод, нет — само значение как есть.
const LEVEL_KEYS = {
  BACHELOR: 'level_BACHELOR',
  MASTER: 'level_MASTER',
  PHD: 'level_PHD',
} as const
const FORM_KEYS = {
  FULL_TIME: 'form_FULL_TIME',
  PART_TIME: 'form_PART_TIME',
  DISTANCE: 'form_DISTANCE',
} as const
const FUNDING_KEYS = {
  GRANT: 'funding_GRANT',
  PAID: 'funding_PAID',
  QUOTA: 'funding_QUOTA',
} as const
const STATUS_KEYS = {
  ACADEMIC_LEAVE: 'status_ACADEMIC_LEAVE',
  EXPELLED: 'status_EXPELLED',
  GRADUATED: 'status_GRADUATED',
} as const

// Статус обучения → тон бейджа. Коды — то, что лежит в базе; русские строки остались от
// вузов, заполнявших поле текстом. Пустой статус у студента с билетом — «Активен».
type StatusTone = 'active' | 'leave' | 'inactive'
const STATUS_TONES: Record<string, StatusTone> = {
  ACTIVE: 'active',
  Обучающийся: 'active',
  ACADEMIC_LEAVE: 'leave',
  'Академический отпуск': 'leave',
  EXPELLED: 'inactive',
  GRADUATED: 'inactive',
}
function statusMeta(status: string | null): { tone: StatusTone; raw: string | null } {
  if (!status) return { tone: 'active', raw: null }
  return { tone: STATUS_TONES[status] ?? 'inactive', raw: status }
}

// Визуальная «карта» цифрового студенческого: шапка вуза, фото, ФИО, статус и реквизиты.
// Используется и на своей карте, и в результате верификации сотрудником. Пустые поля скрываются.
export function StudentIdCardFace({ card, footer }: { card: Card; footer?: ReactNode }) {
  const t = useTranslations('StudentId')
  const locale = useLocale()
  const fullName = [card.lastName, card.firstName, card.middleName].filter(Boolean).join(' ')
  const uniLabel = card.universityShort || card.university
  const status = statusMeta(card.academicStatus)

  // Код из справочника → перевод; неизвестное значение показываем как пришло.
  function decode(dict: Record<string, string>, raw: string | null): string | null {
    if (!raw) return null
    const key = dict[raw]
    return key ? t(key) : raw
  }

  // Реквизиты: только заполненные поля (без «—»). Длинные названия — на всю ширину и с
  // переносом; порядок повторяет бумажный билет: где учится → что изучает → на каких
  // условиях → кто он по документам.
  const rows: { label: string; value: string; wide?: boolean; mono?: boolean }[] = []
  if (card.university) rows.push({ label: t('university'), value: card.university, wide: true })
  if (card.faculty) rows.push({ label: t('faculty'), value: card.faculty, wide: true })
  if (card.specialty) rows.push({ label: t('specialty'), value: card.specialty, wide: true })
  if (card.group) rows.push({ label: t('group'), value: card.group })
  if (card.course != null) rows.push({ label: t('course'), value: String(card.course) })
  const level = decode(LEVEL_KEYS, card.educationLevel)
  if (level) rows.push({ label: t('educationLevel'), value: level })
  const form = decode(FORM_KEYS, card.studyForm)
  if (form) rows.push({ label: t('studyForm'), value: form })
  const funding = decode(FUNDING_KEYS, card.fundingType)
  if (funding) rows.push({ label: t('fundingType'), value: funding })
  if (card.birthDate) {
    rows.push({
      label: t('birthDate'),
      value: new Date(card.birthDate).toLocaleDateString(locale),
    })
  }
  if (card.enrollmentYear)
    rows.push({ label: t('enrollmentYear'), value: String(card.enrollmentYear) })
  if (card.graduationYear) rows.push({ label: t('validUntil'), value: String(card.graduationYear) })
  if (card.studentCardNumber)
    rows.push({ label: t('cardNumber'), value: card.studentCardNumber, mono: true })
  if (card.dormitory) rows.push({ label: t('dormitory'), value: card.dormitory, wide: true })

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

      {/* Тело карты: на широком экране данные слева, QR (footer) справа — карта
          растянута на всю ширину контента, и вертикальная колонка оставляла бы половину
          экрана пустой. Без footer (проверка сотрудником) делить нечего. */}
      <div className={cn('relative flex flex-col', footer && 'lg:flex-row lg:items-stretch')}>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Личность: крупное фото, ФИО, статус обучения. */}
          <div className="flex gap-4 p-5">
            <Avatar className="size-24 shrink-0 rounded-xl ring-2 ring-primary/15 md:size-32">
              <AvatarImage src={card.avatarUrl ?? undefined} alt="" className="object-cover" />
              <AvatarFallback className="rounded-xl text-xl">
                {card.firstName[0]}
                {card.lastName[0]}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg leading-tight font-semibold break-words md:text-xl">
                {fullName}
              </h2>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('studentCard')}
              </p>
              <div className="mt-2">
                <StatusBadge tone={status.tone} label={decode(STATUS_KEYS, status.raw)} t={t} />
              </div>
            </div>
          </div>

          {/* Реквизиты — компактной сеткой, только заполненные. */}
          {rows.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border px-5 py-4 text-sm xl:grid-cols-3">
              {rows.map((r) => (
                <div key={r.label} className={cn('min-w-0', r.wide && 'col-span-full')}>
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
        </div>

        {/* Колонка QR: ширина под код 288px плюс отступы карты. */}
        {footer && <div className="lg:w-[22rem] lg:shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

function StatusBadge({
  tone,
  label,
  t,
}: {
  tone: StatusTone
  // Готовая подпись: код статуса уже переведён вызывающим (у него есть таблица ключей).
  label: string | null
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
  return <Badge variant={tone === 'leave' ? 'warning' : 'secondary'}>{label}</Badge>
}
