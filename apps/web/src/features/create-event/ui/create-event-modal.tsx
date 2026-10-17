'use client'

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
import { useErrorToast } from '../../../shared/lib'
import { createEventRequest, eventKeys } from '../../../entities/event'
import { GroupSelect } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  Button,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { EventDetailsFields } from './event-details-fields'

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
  const { show: showApiError } = useErrorToast('create-event')
  const role = useAppSelector((s) => s.auth.role)
  const audiences = role ? (UI_AUDIENCES[role] ?? []) : []

  const form = useForm<CreateEventInput>({
    resolver: zodResolver(CreateEventSchema),
    defaultValues: { audience: audiences[0], isOnline: false },
  })
  const audience = form.watch('audience')
  const showGroup = audience === 'GROUP' && role !== null && GROUP_PICKER_ROLES.includes(role)
  const showFaculty = audience === 'FACULTY' && role !== null && FACULTY_PICKER_ROLES.includes(role)

  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: showFaculty,
  })

  const mutation = useMutation({
    mutationFn: (input: CreateEventInput) => createEventRequest(input),
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
        <EventDetailsFields form={form} mode="create">
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
                <Label htmlFor="e-group">{t('group')}</Label>
                {/* Поиск по группам на сервере, а не первые 100 по алфавиту. */}
                <Controller
                  control={form.control}
                  name="groupId"
                  render={({ field }) => (
                    <GroupSelect
                      id="e-group"
                      value={field.value ?? null}
                      onChange={(v) => field.onChange(v ?? undefined)}
                      placeholder={t('selectGroup')}
                    />
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
        </EventDetailsFields>

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
