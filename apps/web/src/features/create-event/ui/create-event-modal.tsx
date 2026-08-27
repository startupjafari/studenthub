'use client'

import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  CreateEventSchema,
  type CreateEventInput,
  type PostAudienceValue,
} from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { useFormAlert } from '../../../shared/lib'
import { createEventRequest, eventKeys } from '../../../entities/event'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  Button,
  Checkbox,
  DateTimePicker,
  FieldError,
  FormAlert,
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

// Кому роль вправе адресовать событие. Сервер проверяет то же самое — здесь только
// не показываем заведомо недоступные варианты.
const UI_AUDIENCES: Partial<Record<Role, PostAudienceValue[]>> = {
  [Role.PLATFORM_ADMIN]: ['ALL'],
  [Role.UNIVERSITY_ADMIN]: ['UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS'],
  [Role.DEAN]: ['FACULTY', 'GROUP'],
  [Role.TEACHER]: ['GROUP', 'SUBJECT'],
  [Role.STAROSTA]: ['GROUP'],
  [Role.STUDENT]: ['GROUP'],
}
const GROUP_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN, Role.TEACHER]
const FACULTY_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN]

// datetime-local ("YYYY-MM-DDTHH:mm", локальное время) → ISO UTC для API.
function toIso(local: string): string {
  return local ? new Date(local).toISOString() : ''
}

/**
 * Создание события.
 *
 * Раньше форма стояла раскрытой над списком и занимала первый экран целиком —
 * при том что читают события куда чаще, чем создают. Теперь это модалка за кнопкой
 * в шапке, собранная как остальные создания в системе.
 */
export function CreateEventModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Events')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const role = useAppSelector((s) => s.auth.role)
  const audiences = role ? (UI_AUDIENCES[role] ?? []) : []

  const form = useForm<CreateEventInput>({
    resolver: zodResolver(CreateEventSchema),
    defaultValues: { audience: audiences[0], isOnline: false },
  })
  const audience = form.watch('audience')
  const isOnline = form.watch('isOnline')
  const showGroup = audience === 'GROUP' && role !== null && GROUP_PICKER_ROLES.includes(role)
  const showFaculty = audience === 'FACULTY' && role !== null && FACULTY_PICKER_ROLES.includes(role)

  const groups = useQuery({
    queryKey: groupKeys.list(),
    queryFn: () => fetchGroups(),
    enabled: showGroup,
  })
  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: showFaculty,
  })

  // Пикеры хранят локальное время ("YYYY-MM-DDTHH:mm"), в форму уходит ISO UTC.
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')

  const mutation = useMutation({
    mutationFn: (input: CreateEventInput) => createEventRequest(input),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventKeys.all })
      toast.success(t('created'))
      onClose()
    },
    onError: (e) => showApiError(e),
  })

  return (
    <Modal onClose={onClose} title={t('newEvent')} size="lg">
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
        <FormAlert error={apiError} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ev-title">{t('eventTitle')}</Label>
          <Input id="ev-title" autoFocus {...form.register('title')} />
          <FieldError>{form.formState.errors.title && t('required')}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ev-desc">{t('description')}</Label>
          <Textarea id="ev-desc" rows={3} {...form.register('description')} />
          <FieldError>{form.formState.errors.description && t('required')}</FieldError>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t('audience')}</Label>
            <Controller
              control={form.control}
              name="audience"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label={t('audience')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {audiences.map((a) => (
                      <SelectItem key={a} value={a}>
                        {t(`audience${a}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {showGroup && (
            <div className="flex flex-col gap-1.5">
              <Label>{t('group')}</Label>
              <Controller
                control={form.control}
                name="groupId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger aria-label={t('group')}>
                      <SelectValue placeholder={t('selectGroup')} />
                    </SelectTrigger>
                    <SelectContent>
                      {(groups.data ?? []).map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          {showFaculty && (
            <div className="flex flex-col gap-1.5">
              <Label>{t('faculty')}</Label>
              <Controller
                control={form.control}
                name="facultyId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger aria-label={t('faculty')}>
                      <SelectValue placeholder={t('selectFaculty')} />
                    </SelectTrigger>
                    <SelectContent>
                      {(faculties.data ?? []).map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t('startsAt')}</Label>
            <DateTimePicker
              value={startLocal}
              aria-label={t('startsAt')}
              onChange={(v) => {
                setStartLocal(v)
                form.setValue('startsAt', toIso(v), { shouldValidate: true })
              }}
            />
            <FieldError>{form.formState.errors.startsAt && t('required')}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('endsAt')}</Label>
            <DateTimePicker
              value={endLocal}
              min={startLocal || undefined}
              aria-label={t('endsAt')}
              onChange={(v) => {
                setEndLocal(v)
                form.setValue('endsAt', v ? toIso(v) : undefined, { shouldValidate: true })
              }}
            />
            <FieldError>{form.formState.errors.endsAt?.message}</FieldError>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Controller
            control={form.control}
            name="isOnline"
            render={({ field }) => (
              <Checkbox
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
                onBlur={field.onBlur}
              />
            )}
          />
          {t('isOnline')}
        </label>

        {/* У онлайн-события «место» — это ссылка на встречу, поэтому подпись меняется:
            поле «Аудитория / адрес» рядом с галочкой «онлайн» сбивало с толку. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ev-loc">{isOnline ? t('meetingLink') : t('location')}</Label>
          <Input
            id="ev-loc"
            {...form.register('location')}
            placeholder={isOnline ? t('meetingLinkPlaceholder') : t('locationPlaceholder')}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {t('createEvent')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
