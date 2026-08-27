'use client'

import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { CreatePairSchema, type CreatePairInput } from '@studenthub/shared-schemas'
import type { ApiErrorBody } from '@studenthub/shared-types'
import { Role } from '@studenthub/shared-types'
import { UserPicker, type PickedUser } from '../../../entities/user'
import { createPairRequest, scheduleKeys } from '../../../entities/schedule'
import type { Room } from '../../../entities/room'
import {
  Button,
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
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEK_TYPES = ['BOTH', 'ODD', 'EVEN'] as const

function apiErr(e: unknown): ApiErrorBody {
  return e as ApiErrorBody
}

/**
 * Добавление пары. День и время приходят от клика по календарю — форма открывается
 * уже заполненной, поэтому в типичном случае остаётся ввести только предмет.
 *
 * Собрана как остальные создания в системе: `Modal` с шапкой и крестиком, поля
 * колонкой с `Label`, парные поля в две колонки, «Отмена» и действие внизу.
 */
export function AddPairModal({
  scheduleId,
  rooms,
  isTeacher,
  meId,
  initial,
  onClose,
}: {
  scheduleId: string
  rooms: Room[]
  isTeacher: boolean
  meId?: string
  initial: { dayOfWeek: number; startTime: string; endTime: string }
  onClose: () => void
}) {
  const t = useTranslations('Schedule')
  const tPeople = useTranslations('People')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { error, show, reset } = useFormAlert()
  const [teacher, setTeacher] = useState<PickedUser | null>(null)

  const form = useForm<CreatePairInput>({
    resolver: zodResolver(CreatePairSchema),
    defaultValues: { scheduleId, weekType: 'BOTH', subject: '', ...initial },
  })

  const createPair = useMutation({
    mutationFn: (input: CreatePairInput) => createPairRequest(input),
    onMutate: () => reset(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.container(scheduleId) })
      void qc.invalidateQueries({ queryKey: scheduleKeys.all })
      toast.success(t('pairCreated'))
      onClose()
    },
    onError: (e) => {
      // Пересечение с другой парой — содержательный конфликт, а не ошибка поля:
      // показываем, с чем именно столкнулись.
      const err = apiErr(e)
      if (err.code === 'CONFLICT') {
        toast.error(t('conflictTitle'), {
          description: err.details?.map((d) => d.message).join('; ') ?? t('conflictGeneric'),
        })
      } else show(e)
    },
  })

  return (
    <Modal onClose={onClose} title={t('addPair')} size="lg">
      <form
        onSubmit={form.handleSubmit((v) =>
          createPair.mutate(isTeacher && meId ? { ...v, teacherId: meId } : v),
        )}
        className="flex flex-col gap-4"
      >
        <FormAlert error={error} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="p-subject">{t('subject')}</Label>
          <Input id="p-subject" autoFocus {...form.register('subject')} />
          <FieldError>{form.formState.errors.subject && t('required')}</FieldError>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t('day')}</Label>
            <Controller
              control={form.control}
              name="dayOfWeek"
              render={({ field }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                >
                  <SelectTrigger aria-label={t('day')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {t(`day${d}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('weekType')}</Label>
            <Controller
              control={form.control}
              name="weekType"
              render={({ field }) => (
                <Select value={field.value ?? 'BOTH'} onValueChange={field.onChange}>
                  <SelectTrigger aria-label={t('weekType')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEK_TYPES.map((w) => (
                      <SelectItem key={w} value={w}>
                        {t(`parity${w}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-start">{t('startTime')}</Label>
            <Input id="p-start" type="time" {...form.register('startTime')} />
            <FieldError>{form.formState.errors.startTime && t('timeInvalid')}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-end">{t('endTime')}</Label>
            <Input id="p-end" type="time" {...form.register('endTime')} />
            <FieldError>
              {form.formState.errors.endTime &&
                (form.formState.errors.endTime.message ?? t('timeInvalid'))}
            </FieldError>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('room')}</Label>
          <Controller
            control={form.control}
            name="roomId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v || null)}>
                <SelectTrigger aria-label={t('room')}>
                  <SelectValue placeholder={t('roomOptional')} />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        {!isTeacher && (
          <div className="flex flex-col gap-1.5">
            <Label>{tPeople('teacherOptional')}</Label>
            <UserPicker
              value={teacher}
              roleFilter={Role.TEACHER}
              placeholder={tPeople('pickUser')}
              onSelect={(u) => {
                setTeacher(u)
                form.setValue('teacherId', u?.id ?? null)
              }}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={createPair.isPending}>
            <Plus className="size-4" aria-hidden />
            {t('addPair')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
