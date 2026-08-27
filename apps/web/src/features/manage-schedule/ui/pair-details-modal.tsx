'use client'

import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CalendarPlus, Save, Trash2 } from 'lucide-react'
import {
  CreateScheduleChangeSchema,
  UpdatePairSchema,
  type CreateScheduleChangeInput,
  type UpdatePairInput,
} from '@studenthub/shared-schemas'
import type { ApiErrorBody } from '@studenthub/shared-types'
import { Role } from '@studenthub/shared-types'
import { UserPicker, type PickedUser } from '../../../entities/user'
import {
  createScheduleChangeRequest,
  deletePairRequest,
  scheduleKeys,
  updatePairRequest,
  type Pair,
} from '../../../entities/schedule'
import type { Room } from '../../../entities/room'
import {
  Button,
  DatePicker,
  FormAlert,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEK_TYPES = ['BOTH', 'ODD', 'EVEN'] as const
const CHANGE_TYPES = ['MOVED', 'ROOM_CHANGED', 'CANCELLED', 'SUBSTITUTED'] as const

function apiErr(e: unknown): ApiErrorBody {
  return e as ApiErrorBody
}

/**
 * Карточка пары: правка постоянного расписания сверху, разовое изменение снизу.
 *
 * Это две РАЗНЫЕ вещи, и раньше доступна была только вторая: «перенести пару» означало
 * создать замену на конкретную дату, а само расписание правилось удалением и созданием
 * заново. Теперь верхняя форма меняет саму пару (день, время, аудитория, преподаватель)
 * через `PATCH /pairs/:id` — тот же путь, что и перетаскивание, только с клавиатуры.
 *
 * Модалка, а не боковая панель: панель отъедала треть ширины у календаря на всех
 * экранах, хотя нужна только когда пару открыли.
 */
export function PairDetailsModal({
  pair,
  rooms,
  canEdit,
  isTeacher,
  containerId,
  onClose,
}: {
  pair: Pair
  rooms: Room[]
  canEdit: boolean
  isTeacher: boolean
  containerId: string
  onClose: () => void
}) {
  const t = useTranslations('Schedule')
  const tPeople = useTranslations('People')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: scheduleKeys.container(containerId) })
    void qc.invalidateQueries({ queryKey: scheduleKeys.all })
  }

  // ── правка самой пары ────────────────────────────────────────────────────
  const [teacher, setTeacher] = useState<PickedUser | null>(
    pair.teacher
      ? { id: pair.teacher.id, firstName: pair.teacher.firstName, lastName: pair.teacher.lastName }
      : null,
  )
  const editForm = useForm<UpdatePairInput>({
    resolver: zodResolver(UpdatePairSchema),
    defaultValues: {
      subject: pair.subject,
      dayOfWeek: pair.dayOfWeek,
      startTime: pair.startTime,
      endTime: pair.endTime,
      weekType: pair.weekType,
      roomId: pair.room?.id ?? null,
      teacherId: pair.teacher?.id ?? null,
    },
  })

  const updatePair = useMutation({
    mutationFn: (input: UpdatePairInput) => updatePairRequest(pair.id, input),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      invalidate()
      toast.success(t('pairUpdated'))
      onClose()
    },
    onError: (e) => {
      // Пересечение с другой парой — не ошибка формы, а содержательный конфликт:
      // показываем, с чем именно столкнулись.
      const err = apiErr(e)
      if (err.code === 'CONFLICT') {
        toast.error(t('conflictTitle'), {
          description: err.details?.map((d) => d.message).join('; ') ?? t('conflictGeneric'),
        })
      } else showApiError(e)
    },
  })

  const deletePair = useMutation({
    mutationFn: () => deletePairRequest(pair.id),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      invalidate()
      toast.success(t('pairDeleted'))
      onClose()
    },
    onError: (e) => showApiError(e),
  })

  // ── разовое изменение ────────────────────────────────────────────────────
  const [changeTeacher, setChangeTeacher] = useState<PickedUser | null>(null)
  const changeForm = useForm<CreateScheduleChangeInput>({
    resolver: zodResolver(CreateScheduleChangeSchema),
    defaultValues: { type: 'CANCELLED', pairId: pair.id },
  })
  const changeType = changeForm.watch('type')

  const createChange = useMutation({
    mutationFn: (input: CreateScheduleChangeInput) => createScheduleChangeRequest(input),
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.all })
      changeForm.reset({ type: 'CANCELLED', pairId: pair.id })
      setChangeTeacher(null)
      toast.success(t('changeCreated'))
    },
    onError: (e) => showApiError(e),
  })

  return (
    <Modal onClose={onClose} title={pair.subject} size="lg">
      <div className="flex flex-col gap-4">
        <FormAlert error={apiError} />

        {isTeacher && !canEdit && (
          <p className="text-sm text-muted-foreground">{t('notYourPair')}</p>
        )}

        {canEdit && (
          <form
            onSubmit={editForm.handleSubmit((v) => updatePair.mutate(v))}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-subject">{t('subject')}</Label>
              <Input id="e-subject" {...editForm.register('subject')} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>{t('day')}</Label>
                <Controller
                  control={editForm.control}
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
                  control={editForm.control}
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
                <Label htmlFor="e-start">{t('startTime')}</Label>
                <Input id="e-start" type="time" {...editForm.register('startTime')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e-end">{t('endTime')}</Label>
                <Input id="e-end" type="time" {...editForm.register('endTime')} />
                {editForm.formState.errors.endTime && (
                  <p className="text-xs text-destructive">
                    {editForm.formState.errors.endTime.message ?? t('timeInvalid')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t('room')}</Label>
              <Controller
                control={editForm.control}
                name="roomId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ''}
                    onValueChange={(v) => field.onChange(v || null)}
                  >
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
                    editForm.setValue('teacherId', u?.id ?? null)
                  }}
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:bg-destructive/10"
                loading={deletePair.isPending}
                onClick={() => {
                  void confirm({ title: t('deletePairConfirm'), destructive: true }).then((ok) => {
                    if (ok) deletePair.mutate()
                  })
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                {t('deletePair')}
              </Button>
              <Button type="submit" loading={updatePair.isPending}>
                <Save className="size-4" aria-hidden />
                {t('save')}
              </Button>
            </div>
          </form>
        )}

        {/* Разовое изменение на дату — только админ/декан (бэк: @Roles без TEACHER). */}
        {!isTeacher && (
          <>
            <div className="border-t border-border" />
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <CalendarPlus className="size-4" aria-hidden />
                {t('createChange')}
              </h3>
              <p className="text-xs text-muted-foreground">{t('createChangeHint')}</p>
            </div>
            <form
              onSubmit={changeForm.handleSubmit((v) => createChange.mutate(v))}
              className="flex flex-col gap-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('changeType')}</Label>
                  <Controller
                    control={changeForm.control}
                    name="type"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger aria-label={t('changeType')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHANGE_TYPES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {t(`changeTypeLabel${c}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('date')}</Label>
                  <Controller
                    control={changeForm.control}
                    name="date"
                    render={({ field }) => (
                      <DatePicker
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        aria-label={t('date')}
                      />
                    )}
                  />
                  {changeForm.formState.errors.date && (
                    <p className="text-xs text-destructive">{t('required')}</p>
                  )}
                </div>
              </div>

              {changeType === 'ROOM_CHANGED' && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('newRoom')}</Label>
                  <Controller
                    control={changeForm.control}
                    name="newRoomId"
                    render={({ field }) => (
                      <Select
                        value={field.value ?? ''}
                        onValueChange={(v) => field.onChange(v || null)}
                      >
                        <SelectTrigger aria-label={t('newRoom')}>
                          <SelectValue placeholder={t('selectRoom')} />
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
              )}

              {changeType === 'MOVED' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nstart">{t('newStartTime')}</Label>
                    <Input id="nstart" type="time" {...changeForm.register('newStartTime')} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nend">{t('newEndTime')}</Label>
                    <Input id="nend" type="time" {...changeForm.register('newEndTime')} />
                  </div>
                </div>
              )}

              {changeType === 'SUBSTITUTED' && (
                <div className="flex flex-col gap-1.5">
                  <Label>{tPeople('teacher')}</Label>
                  <UserPicker
                    value={changeTeacher}
                    roleFilter={Role.TEACHER}
                    placeholder={tPeople('pickUser')}
                    onSelect={(u) => {
                      setChangeTeacher(u)
                      changeForm.setValue('newTeacherId', u?.id ?? null)
                    }}
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="note">{t('note')}</Label>
                <Input
                  id="note"
                  {...changeForm.register('note')}
                  placeholder={t('notePlaceholder')}
                />
              </div>

              <Button type="submit" variant="outline" loading={createChange.isPending}>
                {t('createChange')}
              </Button>
            </form>
          </>
        )}
      </div>
    </Modal>
  )
}
