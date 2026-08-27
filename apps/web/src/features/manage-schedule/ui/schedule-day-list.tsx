'use client'

import { useTranslations } from 'next-intl'
import { Clock, MapPin, Plus, User } from 'lucide-react'
import type { Pair } from '../../../entities/schedule'
import { Button, SegmentedTabs } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

const DAYS = [1, 2, 3, 4, 5, 6, 7]

/**
 * Расписание на телефоне: один день за раз.
 *
 * Недельная сетка на 360 px нечитаема — семь колонок дают по 40 px на день, в которые
 * не влезает даже название предмета. Поэтому под `md` показываем выбранный день
 * списком: пары идут по времени, каждая — обычная кнопка. Перетаскивание здесь не
 * нужно и не работало бы: перенос делается формой в карточке пары, тем же действием,
 * что и на компьютере.
 */
export function ScheduleDayList({
  pairs,
  day,
  onDayChange,
  selectedPairId,
  todayDow,
  onPairClick,
  onAdd,
}: {
  pairs: Pair[]
  day: number
  onDayChange: (day: number) => void
  selectedPairId: string | null
  todayDow: number
  onPairClick: (pair: Pair) => void
  onAdd: (day: number) => void
}) {
  const t = useTranslations('Schedule')
  const dayPairs = pairs
    .filter((p) => p.dayOfWeek === day)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SegmentedTabs
        aria-label={t('day')}
        value={String(day)}
        onChange={(v) => onDayChange(Number(v))}
        items={DAYS.map((d) => ({
          value: String(d),
          // Короткая подпись: полные названия дней в семь вкладок не помещаются.
          label: (
            <span className={cn(d === todayDow && 'text-primary')}>{t(`day${d}`).slice(0, 2)}</span>
          ),
          // Счётчик пар сразу показывает, где день пустой, а где перегружен.
          count: pairs.filter((p) => p.dayOfWeek === d).length,
        }))}
      />

      <div className="sh-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {dayPairs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('noPairs')}</p>
        ) : (
          dayPairs.map((pair) => (
            <button
              key={pair.id}
              type="button"
              onClick={() => onPairClick(pair)}
              className={cn(
                'flex flex-col gap-1 rounded-xl border-l-2 border-l-primary bg-primary/10 px-3 py-2.5 text-left outline-none transition-shadow hover:ring-1 hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring',
                pair.id === selectedPairId && 'ring-2 ring-primary',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {pair.subject}
                </span>
                {pair.weekType !== 'BOTH' && (
                  <span className="shrink-0 rounded bg-primary/20 px-1.5 text-[0.65rem] font-medium">
                    {t(`parity${pair.weekType}`)}
                  </span>
                )}
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                {pair.startTime}–{pair.endTime}
              </span>
              {pair.room && (
                <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  {pair.room.name}
                </span>
              )}
              {pair.teacher && (
                <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <User className="size-3.5 shrink-0" aria-hidden />
                  {pair.teacher.lastName} {pair.teacher.firstName}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      <Button type="button" className="w-full" onClick={() => onAdd(day)}>
        <Plus className="size-4" aria-hidden />
        {t('addPair')}
      </Button>
    </div>
  )
}
