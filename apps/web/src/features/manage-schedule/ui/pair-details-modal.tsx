'use client'

import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarPlus, History, Save, Trash2, Undo2 } from 'lucide-react'
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
  deleteScheduleChangeRequest,
  fetchScheduleChanges,
  nowInTz,
  scheduleKeys,
  updatePairRequest,
  type Pair,
  type ScheduleChange,
} from '../../../entities/schedule'
import { RoomSelect } from '../../../entities/room'
import {
  Button,
  DatePicker,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useConfirm,
  FieldError,
} from '../../../shared/ui'
import { isoWeekParity, useErrorToast } from '../../../shared/lib'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEK_TYPES = ['BOTH', 'ODD', 'EVEN'] as const
const CHANGE_TYPES = ['MOVED', 'ROOM_CHANGED', 'CANCELLED', 'SUBSTITUTED'] as const

function apiErr(e: unknown): ApiErrorBody {
  return e as ApiErrorBody
}

// Окно разовых изменений пары в карточке: неделя назад (исправить свежую ошибку) и
// на семестр вперёд.
const CHANGES_PAST_DAYS = 7
const CHANGES_AHEAD_DAYS = 120

// «YYYY-MM-DD» ± дни — календарная арифметика в UTC, без сдвига поясом браузера.
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ISO-день недели даты «YYYY-MM-DD» (1 — понедельник), как его считает сервер.
function isoDayOfWeek(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
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
  universityId,
  canEdit,
  isTeacher,
  containerId,
  containerActive,
  onClose,
}: {
  pair: Pair
  // Вуз для выбора аудитории (платформенной роли; вуз-ролям сервер подставит свой).
  universityId?: string
  canEdit: boolean
  isTeacher: boolean
  containerId: string
  // Версия действует: разовые изменения есть только у её пар (черновик группе не виден).
  containerActive: boolean
  onClose: () => void
}) {
  const t = useTranslations('Schedule')
  const tPeople = useTranslations('People')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { show: showApiError } = useErrorToast('pair-details')

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
    onSuccess: () => {
      invalidate()
      toast.success(t('pairDeleted'))
      onClose()
    },
    onError: (e) => {
      // CONFLICT при удалении — по паре уже отмечена посещаемость: сервер её бережёт
      // и предлагает перенос вместо удаления.
      if (apiErr(e).code === 'CONFLICT') {
        toast.error(t('deletePairHasAttendance'), {
          id: 'pair-details',
          description: t('deletePairHasAttendanceHint'),
        })
      } else showApiError(e)
    },
  })

  // ── разовое изменение ────────────────────────────────────────────────────
  const [changeTeacher, setChangeTeacher] = useState<PickedUser | null>(null)
  const changeForm = useForm<CreateScheduleChangeInput>({
    resolver: zodResolver(CreateScheduleChangeSchema),
    defaultValues: { type: 'CANCELLED', pairId: pair.id },
  })
  const changeType = changeForm.watch('type')
  // Ошибки полей разового изменения — под полями: раньше показывалась только дата, и
  // кнопка без аудитории, заменяющего или времени молча ничего не делала.
  const changeErrors = changeForm.formState.errors

  const createChange = useMutation({
    mutationFn: (input: CreateScheduleChangeInput) => createScheduleChangeRequest(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.all })
      changeForm.reset({ type: 'CANCELLED', pairId: pair.id })
      setChangeTeacher(null)
      toast.success(t('changeCreated'))
    },
    onError: (e) => {
      // Сервер сверяет изменение с фактической сеткой даты: занятый преподаватель или
      // аудитория, отменённое занятие — показываем, с чем столкнулись.
      const err = apiErr(e)
      if (err.code === 'CONFLICT') {
        toast.error(t('conflictTitle'), {
          id: 'pair-details',
          description: err.details?.map((d) => d.message).join('; ') ?? t('conflictGeneric'),
        })
      } else showApiError(e)
    },
  })

  function onCreateChange(values: CreateScheduleChangeInput): void {
    // Изменение на день, когда пары нет, никто не увидит — сервер его тоже отклонит.
    if (isoDayOfWeek(values.date) !== pair.dayOfWeek) {
      changeForm.setError('date', { type: 'wrongDay' })
      return
    }
    // То же с чётностью: пара нечётных недель на чётной не проводится (ISO-неделя, как на
    // сервере и в сетке).
    const parity = isoWeekParity(new Date(`${values.date}T00:00:00`))
    if (pair.weekType !== 'BOTH' && pair.weekType !== parity) {
      changeForm.setError('date', { type: 'wrongWeek' })
      return
    }
    createChange.mutate(values)
  }

  // ── разовые изменения этой пары: убрать ошибочное (C-F16) ────────────────
  const changesRange = useMemo(() => {
    const today = nowInTz(null).date
    return {
      from: shiftDate(today, -CHANGES_PAST_DAYS),
      to: shiftDate(today, CHANGES_AHEAD_DAYS),
      groupId: pair.groupId,
    }
  }, [pair.groupId])
  const changes = useQuery({
    queryKey: scheduleKeys.changes(changesRange),
    queryFn: () => fetchScheduleChanges(changesRange),
    enabled: !isTeacher && containerActive,
  })
  const pairChanges = (changes.data ?? []).filter((c) => c.pairId === pair.id)

  const removeChange = useMutation({
    mutationFn: (id: string) => deleteScheduleChangeRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.all })
      toast.success(t('changeRemoved'))
    },
    onError: (e) => showApiError(e),
  })

  function changeDetail(c: ScheduleChange): string | null {
    if (c.type === 'MOVED' && c.newStartTime && c.newEndTime) {
      return `${c.newStartTime}–${c.newEndTime}`
    }
    if (c.type === 'ROOM_CHANGED') return c.newRoom?.name ?? null
    if (c.type === 'SUBSTITUTED' && c.newTeacher) {
      return `${c.newTeacher.lastName} ${c.newTeacher.firstName}`
    }
    return null
  }

  return (
    <Modal onClose={onClose} title={pair.subject} size="lg">
      <div className="flex flex-col gap-4">
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
              <FieldError>{editForm.formState.errors.subject && t('required')}</FieldError>
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
                <FieldError>{editForm.formState.errors.startTime && t('timeInvalid')}</FieldError>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e-end">{t('endTime')}</Label>
                <Input id="e-end" type="time" {...editForm.register('endTime')} />
                <FieldError>
                  {editForm.formState.errors.endTime &&
                    (editForm.formState.errors.endTime.message ?? t('timeInvalid'))}
                </FieldError>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-room">{t('roomOptional')}</Label>
              <Controller
                control={editForm.control}
                name="roomId"
                render={({ field }) => (
                  <RoomSelect
                    id="e-room"
                    universityId={universityId}
                    value={field.value ?? null}
                    onChange={field.onChange}
                    initialLabel={pair.room?.name ?? null}
                  />
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
                  void confirm({
                    title: t('deletePairConfirm'),
                    description: t('deletePairConfirmHint'),
                    destructive: true,
                  }).then((ok) => {
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

        {/* Разовое изменение на дату — только админ/декан (бэк: @Roles без TEACHER) и только
            у пары действующей версии: черновик группе не виден, а пуш ушёл бы всем. */}
        {!isTeacher && !containerActive && (
          <>
            <div className="border-t border-border" />
            <p className="text-xs text-muted-foreground">{t('changeDraftHint')}</p>
          </>
        )}
        {!isTeacher && containerActive && (
          <>
            <div className="border-t border-border" />
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <CalendarPlus className="size-4" aria-hidden />
                {t('createChange')}
              </h3>
              <p className="text-xs text-muted-foreground">{t('createChangeHint')}</p>
            </div>
            {pairChanges.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <History className="size-4" aria-hidden />
                  {t('pairChanges')}
                </h3>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {pairChanges.map((c) => {
                    const detail = changeDetail(c)
                    return (
                      <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                          {new Date(`${c.date.slice(0, 10)}T00:00:00`).toLocaleDateString(locale, {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {t(`changeTypeLabel${c.type}`)}
                          {detail ? ` · ${detail}` : ''}
                          {c.note ? ` · ${c.note}` : ''}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={t('removeChange')}
                          title={t('removeChange')}
                          loading={removeChange.isPending && removeChange.variables === c.id}
                          onClick={() => {
                            void confirm({
                              title: t('removeChangeConfirm'),
                              description: t('removeChangeConfirmHint'),
                              destructive: true,
                            }).then((ok) => {
                              if (ok) removeChange.mutate(c.id)
                            })
                          }}
                        >
                          <Undo2 className="size-4 text-muted-foreground" aria-hidden />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <form
              onSubmit={changeForm.handleSubmit(onCreateChange)}
              className="flex flex-col gap-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('changeType')}</Label>
                  <Controller
                    control={changeForm.control}
                    name="type"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(next) => {
                          field.onChange(next)
                          // Значения прежнего типа не уходят с новым: «смена аудитории»
                          // иначе несла заменяющего, выбранного для «замены».
                          changeForm.setValue('newRoomId', undefined)
                          changeForm.setValue('newTeacherId', undefined)
                          changeForm.setValue('newStartTime', undefined)
                          changeForm.setValue('newEndTime', undefined)
                          setChangeTeacher(null)
                        }}
                      >
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
                  <FieldError>
                    {changeForm.formState.errors.date && (
                      <>
                        {changeForm.formState.errors.date.type === 'wrongDay'
                          ? t('changeWrongDay', { day: t(`day${pair.dayOfWeek}`) })
                          : changeForm.formState.errors.date.type === 'wrongWeek'
                            ? t('changeWrongWeek', { parity: t(`parity${pair.weekType}`) })
                            : t('required')}
                      </>
                    )}
                  </FieldError>
                </div>
              </div>

              {changeType === 'ROOM_CHANGED' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="c-room">{t('newRoom')}</Label>
                  <Controller
                    control={changeForm.control}
                    name="newRoomId"
                    render={({ field }) => (
                      <RoomSelect
                        id="c-room"
                        universityId={universityId}
                        value={field.value ?? null}
                        onChange={field.onChange}
                      />
                    )}
                  />
                  <FieldError>{changeErrors.newRoomId && t('required')}</FieldError>
                </div>
              )}

              {changeType === 'MOVED' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nstart">{t('newStartTime')}</Label>
                    <Input id="nstart" type="time" {...changeForm.register('newStartTime')} />
                    <FieldError>{changeErrors.newStartTime && t('required')}</FieldError>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nend">{t('newEndTime')}</Label>
                    <Input id="nend" type="time" {...changeForm.register('newEndTime')} />
                    <FieldError>
                      {changeErrors.newEndTime &&
                        (changeForm.getValues('newEndTime') ? t('timeInvalid') : t('required'))}
                    </FieldError>
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
                  <FieldError>{changeErrors.newTeacherId && t('required')}</FieldError>
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
