'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, Clock, MapPin, User, type LucideIcon } from 'lucide-react'
import { Badge, Button, Modal } from '../../../shared/ui'
import { ProfileLink } from '../../../entities/user'
import { useAppSelector } from '../../../shared/store'
import { cn } from '../../../shared/lib/utils'
import type { Pair, ScheduleChange } from '../../../entities/schedule'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
function minToLabel(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}

const CHANGE_LABEL: Record<ScheduleChange['type'], string> = {
  MOVED: 'changeMoved',
  ROOM_CHANGED: 'changeRoom',
  CANCELLED: 'changeCancelled',
  SUBSTITUTED: 'changeSubstituted',
}
const STUDENT_ROLES = ['STUDENT', 'STAROSTA']

// Интерактивная карточка пары (docs/UNIFIED_UX.md PR-3b): блок расписания открывает деталь
// с преподавателем/аудиторией/временем/заменой и переходом в Workspace дисциплины (где живут
// материалы/задания/оценки/посещаемость/чат этой пары). Один клик — единая дисциплина.
//
// Окно, а не боковая панель: у детали пары пять строк, и панель во всю высоту экрана
// ради них оставляла под собой пустоту в три четверти высоты. Панель вдобавок наезжала
// на саму сетку — пара, по которой щёлкнули, оказывалась под ней, и сверить деталь с
// соседними занятиями было нельзя. Окно по центру ничего не перекрывает по краям.
export function PairDetailModal({
  pair,
  change,
  gridStart,
  gridSpan,
  date,
  col = 0,
  cols = 1,
}: {
  pair: Pair
  change: ScheduleChange | undefined
  gridStart: number
  /** Длина окна сетки в минутах: позиция и высота пары считаются долей от него. */
  gridSpan: number
  date: string
  // Колонка внутри кластера пересечений (Google-Calendar-раскладка): рядом, а не поверх.
  col?: number
  cols?: number
}) {
  const t = useTranslations('Schedule')
  const locale = useLocale()
  const role = useAppSelector((s) => s.auth.role)

  const cancelled = change?.type === 'CANCELLED'
  const startMin = change?.newStartTime ? toMin(change.newStartTime) : toMin(pair.startTime)
  const endMin = change?.newEndTime ? toMin(change.newEndTime) : toMin(pair.endTime)
  const room = change?.newRoom ?? pair.room
  const teacher = change?.newTeacher ?? pair.teacher
  // Доли от окна сетки, а не пиксели: сетка растягивается на свободную высоту страницы,
  // и пара обязана тянуться вместе с ней (см. schedule-grid.tsx).
  const top = `${((startMin - gridStart) / gridSpan) * 100}%`
  const height = `${Math.max(((endMin - startMin) / gridSpan) * 100, 0)}%`
  // Плотность — по ДЛИТЕЛЬНОСТИ, а не по высоте в пикселях: высоты в пикселях здесь
  // больше нет, а порог в 55 минут это тот же прежний порог в 52px при часе в 56px.
  const compact = endMin - startMin < 55
  const isStudent = role ? STUDENT_ROLES.includes(role) : false
  const [open, setOpen] = useState(false)

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'absolute z-10 cursor-pointer overflow-hidden rounded-lg border-l-2 px-1.5 py-1 text-left transition-shadow hover:ring-1 hover:ring-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          cancelled
            ? 'border-l-muted-foreground/40 bg-muted text-muted-foreground line-through'
            : change
              ? 'border-l-warning bg-warning/10'
              : 'border-l-primary bg-primary/10',
        )}
        style={{
          top,
          height,
          minHeight: 22,
          left: `calc(${(col / cols) * 100}% + 2px)`,
          width: `calc(${(1 / cols) * 100}% - 4px)`,
        }}
        title={`${pair.subject} · ${minToLabel(startMin)}–${minToLabel(endMin)}`}
      >
        <div className="truncate text-xs font-semibold">{pair.subject}</div>
        <div className="truncate text-[0.7rem] opacity-80">
          {minToLabel(startMin)}–{minToLabel(endMin)}
        </div>
        {!compact && room && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[0.7rem] opacity-80">
            <MapPin className="size-3 shrink-0" aria-hidden />
            {room.name}
          </div>
        )}
        {!compact && teacher && (
          <div className="flex items-center gap-1 truncate text-[0.7rem] opacity-80">
            <User className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {teacher.lastName} {teacher.firstName}
            </span>
          </div>
        )}
        {change && (
          <div className="mt-0.5 truncate text-[0.65rem] font-medium">
            {t(CHANGE_LABEL[change.type])}
          </div>
        )}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} title={pair.subject} size="md">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <DetailRow icon={Clock}>
                <span className="capitalize">{dateLabel}</span> · {minToLabel(startMin)}–
                {minToLabel(endMin)}
              </DetailRow>
              {room && <DetailRow icon={MapPin}>{room.name}</DetailRow>}
              {teacher && (
                <DetailRow icon={User}>
                  {teacher.id ? (
                    <ProfileLink userId={teacher.id} className="hover:underline">
                      {teacher.lastName} {teacher.firstName}
                    </ProfileLink>
                  ) : (
                    <span>
                      {teacher.lastName} {teacher.firstName}
                    </span>
                  )}
                </DetailRow>
              )}

              <div className="flex flex-wrap gap-1.5">
                {pair.weekType !== 'BOTH' && (
                  <Badge variant="outline">
                    {t(pair.weekType === 'ODD' ? 'parityODD' : 'parityEVEN')}
                  </Badge>
                )}
                {cancelled ? (
                  <Badge variant="destructive">{t('changeCancelled')}</Badge>
                ) : (
                  change && <Badge variant="secondary">{t(CHANGE_LABEL[change.type])}</Badge>
                )}
              </div>

              {change?.note && <p className="text-sm text-muted-foreground">{change.note}</p>}
            </div>

            {/* Переход в единую дисциплину — там расписание/задания/материалы/оценки/посещаемость/чат
                этой пары (см. Workspace дисциплины, PR-3). Для студенческих ролей.
                Окно закрываем сами: переход клиентский, и без этого оно осталось бы
                висеть поверх нового экрана. */}
            {isStudent && !cancelled && (
              <Button asChild className="gap-1.5" onClick={() => setOpen(false)}>
                <Link href={`/courses/${encodeURIComponent(pair.subject)}`}>
                  {t('openDiscipline')}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

function DetailRow({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  )
}
