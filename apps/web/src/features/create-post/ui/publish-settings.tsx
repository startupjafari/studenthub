'use client'

import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, FileText, Settings2, X } from 'lucide-react'
import { Button, DateTimePicker, Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/** Пояс браузера — в нём читается значение поля даты и времени. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

/**
 * Настройки публикации — отдельным компактным поповером, а не строкой в подвале: отложенная
 * публикация и сохранение в черновики нужны редко, а постоянное место в подвале отнимали у
 * главного действия. Время читается в поясе браузера — он подписан под полем.
 */
export function PublishSettings({
  open,
  onOpenChange,
  scheduleAt,
  onScheduleChange,
  onSaveDraft,
  disabled,
  savingDraft,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduleAt: string
  onScheduleChange: (value: string) => void
  onSaveDraft: () => void
  disabled?: boolean
  savingDraft?: boolean
}) {
  const t = useTranslations('Feed')
  const tCommon = useTranslations('Common')
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('publishSettings')}
          title={t('publishSettings')}
          className={cn(TOOL_BUTTON, (open || scheduleAt) && 'bg-muted text-foreground')}
        >
          <Settings2 className="size-5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 p-3"
      >
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
            {t('scheduleLabel')}
          </p>
          <div className="flex items-center gap-1.5">
            <DateTimePicker
              value={scheduleAt}
              onChange={onScheduleChange}
              aria-label={t('scheduleLabel')}
              className="min-w-0 flex-1"
            />
            {scheduleAt && (
              <Button
                type="button"
                icon
                variant="ghost"
                aria-label={t('cancelSchedule')}
                title={t('cancelSchedule')}
                onClick={() => onScheduleChange('')}
              >
                <X className="size-4" aria-hidden />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('scheduleTimezone', { zone: browserTimeZone() })}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            loading={savingDraft}
            onClick={onSaveDraft}
          >
            <FileText className="size-4" aria-hidden />
            {t('saveDraft')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
            {tCommon('done')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Чип запланированной публикации над подвалом: когда выйдет пост, правка и отмена. */
export function ScheduledChip({
  scheduleAt,
  onEdit,
  onClear,
}: {
  scheduleAt: string
  onEdit: () => void
  onClear: () => void
}) {
  const t = useTranslations('Feed')
  const locale = useLocale()
  const when = new Date(scheduleAt)
  if (Number.isNaN(when.getTime())) return null
  const label = when.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <div className="flex items-center gap-1 self-start rounded-full bg-info/10 py-1 pr-1 pl-3 text-xs font-medium text-info">
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      <button
        type="button"
        onClick={onEdit}
        className="cursor-pointer rounded px-1 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        {t('scheduledFor', { when: label })}
      </button>
      <button
        type="button"
        aria-label={t('cancelSchedule')}
        title={t('cancelSchedule')}
        onClick={onClear}
        className="flex size-6 cursor-pointer items-center justify-center rounded-full hover:bg-info/15 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** Иконка-инструмент подвала: 44px под палец, 40px под курсор. */
export const TOOL_BUTTON =
  'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 sm:size-10'
