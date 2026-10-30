'use client'

import { useState, type ReactNode } from 'react'
import { Controller, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Checkbox, DateTimePicker, FieldError, Input, Label, Textarea } from '../../../shared/ui'

/** Общая часть формы события: у создания и правки эти поля одни и те же. */
export interface EventDetailsValues {
  title?: string
  description?: string
  location?: string | null
  isOnline?: boolean
  meetingUrl?: string | null
  meetingPasscode?: string | null
  startsAt?: string
  endsAt?: string | null
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// datetime-local ("YYYY-MM-DDTHH:mm", локальное время) → ISO UTC для API.
function toIso(local: string): string {
  return local ? new Date(local).toISOString() : ''
}

// ISO из API → значение пикера в локальном времени (правка уже сохранённого события).
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Пустое поле ссылки — «не указано», а не невалидная ссылка. При правке: текущую ссылку админ
// без регистрации прочитать не может, и пустое поле её не трогает. При создании: включили
// «Онлайн» и выключили — в форме оставалась пустая строка, схема отвергала её как ссылку, а
// ошибку под скрытым полем не видно — форма молча не отправлялась.
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v

interface EventDetailsFieldsProps<T extends FieldValues> {
  form: UseFormReturn<T>
  /**
   * create — пустое «Окончание» просто не уходит; edit — `null` стирает сохранённый конец,
   * а пустая ссылка на встречу означает «не менять».
   */
  mode: 'create' | 'edit'
  /** Подсказка под полем ссылки (правка, когда текущую ссылку прочитать не удалось). */
  meetingHint?: string
  /** Поля между описанием и временем — аудитория при создании. */
  children?: ReactNode
}

/**
 * Название, описание, время, онлайн/место и встреча — общая часть создания и правки
 * события. Пикеры хранят локальное время ("YYYY-MM-DDTHH:mm"), в форму уходит ISO UTC.
 */
export function EventDetailsFields<T extends EventDetailsValues & FieldValues>({
  form: typedForm,
  mode,
  meetingHint,
  children,
}: EventDetailsFieldsProps<T>) {
  const t = useTranslations('Events')
  // Типы форм создания и правки разные (CreateEventInput / UpdateEventInput), поля — общие:
  // компонент работает с их пересечением.
  const form = typedForm as unknown as UseFormReturn<EventDetailsValues>
  const errors = form.formState.errors
  const isOnline = form.watch('isOnline')

  const [startLocal, setStartLocal] = useState(() => toLocalInput(form.getValues('startsAt')))
  const [endLocal, setEndLocal] = useState(() => toLocalInput(form.getValues('endsAt')))

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ev-title">{t('eventTitle')}</Label>
        <Input id="ev-title" autoFocus {...form.register('title')} />
        <FieldError>{errors.title && t('required')}</FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ev-desc">{t('description')}</Label>
        <Textarea id="ev-desc" rows={3} {...form.register('description')} />
        <FieldError>{errors.description && t('required')}</FieldError>
      </div>

      {children}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>{t('startsAt')}</Label>
          <DateTimePicker
            value={startLocal}
            aria-label={t('startsAt')}
            onChange={(v) => {
              setStartLocal(v)
              form.setValue('startsAt', toIso(v), { shouldValidate: true, shouldDirty: true })
            }}
          />
          <FieldError>{errors.startsAt && t('required')}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('endsAt')}</Label>
          <DateTimePicker
            value={endLocal}
            min={startLocal || undefined}
            aria-label={t('endsAt')}
            onChange={(v) => {
              setEndLocal(v)
              const cleared = mode === 'edit' ? null : undefined
              form.setValue('endsAt', v ? toIso(v) : cleared, {
                shouldValidate: true,
                shouldDirty: true,
              })
            }}
          />
          <FieldError>{errors.endsAt?.message}</FieldError>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Controller
          control={form.control}
          name="isOnline"
          render={({ field }) => (
            <Checkbox
              checked={field.value === true}
              onCheckedChange={(v) => {
                field.onChange(v === true)
                // Очное событие при создании встречи не несёт: ссылка, набранная и
                // оставленная за выключенным «Онлайн», сделала бы его онлайновым на сервере.
                if (v !== true && mode === 'create') {
                  form.setValue('meetingUrl', undefined)
                  form.setValue('meetingPasscode', undefined)
                  form.clearErrors(['meetingUrl', 'meetingPasscode'])
                }
              }}
              onBlur={field.onBlur}
            />
          )}
        />
        {t('isOnline')}
      </label>

      {/* У онлайн-события место и способ подключения — разные вещи, и поля разные:
          ссылка уходит в meetingUrl, который видят только участники, а `location`
          остаётся адресом аудитории. Раньше ссылку клали туда же, куда адрес. */}
      {isOnline ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="ev-meeting">{t('meetingLink')}</Label>
            <Input
              id="ev-meeting"
              type="url"
              inputMode="url"
              {...form.register('meetingUrl', { setValueAs: blankToUndefined })}
              placeholder={t('meetingLinkPlaceholder')}
            />
            {meetingHint && <p className="text-xs text-muted-foreground">{meetingHint}</p>}
            <FieldError>{errors.meetingUrl && t('meetingLinkInvalid')}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5 sm:w-48">
            <Label htmlFor="ev-passcode">{t('meetingPasscode')}</Label>
            <Input
              id="ev-passcode"
              {...form.register('meetingPasscode')}
              placeholder={t('meetingPasscodePlaceholder')}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ev-loc">{t('location')}</Label>
          <Input
            id="ev-loc"
            {...form.register('location')}
            placeholder={t('locationPlaceholder')}
          />
        </div>
      )}
    </>
  )
}
