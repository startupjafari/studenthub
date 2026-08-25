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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DateTimePicker,
  FormAlert,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'

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

export function CreateEventForm() {
  const t = useTranslations('Events')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const role = useAppSelector((s) => s.auth.role)
  const audiences = role ? (UI_AUDIENCES[role] ?? []) : []

  const form = useForm<CreateEventInput>({
    resolver: zodResolver(CreateEventSchema),
    defaultValues: { audience: audiences[0], isOnline: false },
  })
  const audience = form.watch('audience')
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
      form.reset({ audience: audiences[0], isOnline: false })
      setStartLocal('')
      setEndLocal('')
      toast.success(t('created'))
    },
    onError: (e) => showApiError(e),
  })

  if (audiences.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('newEvent')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="grid gap-3 sm:grid-cols-2"
        >
          {apiError && (
            <div className="sm:col-span-2">
              <FormAlert error={apiError} />
            </div>
          )}
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="ev-title">{t('eventTitle')}</Label>
            <Input id="ev-title" {...form.register('title')} />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">{t('required')}</p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="ev-desc">{t('description')}</Label>
            <textarea
              id="ev-desc"
              rows={3}
              {...form.register('description')}
              className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
            />
            {form.formState.errors.description && (
              <p className="text-xs text-destructive">{t('required')}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('audience')}</Label>
            <Controller
              control={form.control}
              name="audience"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
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
            <div className="flex flex-col gap-2">
              <Label>{t('group')}</Label>
              <Controller
                control={form.control}
                name="groupId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger>
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
            <div className="flex flex-col gap-2">
              <Label>{t('faculty')}</Label>
              <Controller
                control={form.control}
                name="facultyId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger>
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

          <div className="flex flex-col gap-2">
            <Label>{t('startsAt')}</Label>
            <DateTimePicker
              value={startLocal}
              aria-label={t('startsAt')}
              onChange={(v) => {
                setStartLocal(v)
                form.setValue('startsAt', toIso(v), { shouldValidate: true })
              }}
            />
            {form.formState.errors.startsAt && (
              <p className="text-xs text-destructive">{t('required')}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
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
            {form.formState.errors.endsAt && (
              <p className="text-xs text-destructive">{form.formState.errors.endsAt.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="ev-loc">{t('location')}</Label>
            <Input
              id="ev-loc"
              {...form.register('location')}
              placeholder={t('locationPlaceholder')}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
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

          <div className="sm:col-span-2">
            <Button type="submit" loading={mutation.isPending}>
              {t('createEvent')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
