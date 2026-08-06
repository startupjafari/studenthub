'use client'

import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CalendarPlus, Check, Layers, MousePointerClick, Plus, Trash2, X } from 'lucide-react'
import {
  CreatePairSchema,
  CreateScheduleChangeSchema,
  type CreatePairInput,
  type CreateScheduleChangeInput,
} from '@studenthub/shared-schemas'
import type { ApiErrorBody } from '@studenthub/shared-types'
import { Role } from '@studenthub/shared-types'
import { UserPicker, type PickedUser } from '../../../entities/user'
import {
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { fetchRooms, roomKeys } from '../../../entities/room'
import { fetchMe, userKeys } from '../../../entities/user'
import {
  createPairRequest,
  createScheduleChangeRequest,
  createScheduleRequest,
  deletePairRequest,
  fetchScheduleContainer,
  fetchScheduleContainers,
  scheduleKeys,
  updateScheduleRequest,
  type Pair,
} from '../../../entities/schedule'
import { ScheduleEditor } from './schedule-editor'

function apiErr(e: unknown): ApiErrorBody {
  return e as ApiErrorBody
}

const DAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEK_TYPES = ['BOTH', 'ODD', 'EVEN'] as const
const CHANGE_TYPES = ['MOVED', 'ROOM_CHANGED', 'CANCELLED', 'SUBSTITUTED'] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function addMinutes(hhmm: string, delta: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  let tot = (h ?? 0) * 60 + (m ?? 0) + delta
  tot = Math.max(0, Math.min(tot, 23 * 60 + 59))
  return `${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`
}

export function ManageSchedule() {
  const t = useTranslations('Schedule')
  const tPeople = useTranslations('People')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })
  const rooms = useQuery({
    queryKey: roomKeys.list(me.data?.universityId ?? undefined),
    queryFn: () => fetchRooms(me.data?.universityId ?? undefined),
    enabled: !!me.data,
  })

  const [groupId, setGroupId] = useState<string>('')
  const [containerId, setContainerId] = useState<string>('')
  const [newContainerOpen, setNewContainerOpen] = useState(false)
  const [selectedPair, setSelectedPair] = useState<Pair | null>(null)

  const containers = useQuery({
    queryKey: scheduleKeys.containers(groupId),
    queryFn: () => fetchScheduleContainers(groupId),
    enabled: !!groupId,
  })

  useEffect(() => {
    if (!containers.data) return
    const active = containers.data.find((c) => c.isActive) ?? containers.data[0]
    setContainerId(active?.id ?? '')
  }, [containers.data])

  const container = useQuery({
    queryKey: scheduleKeys.container(containerId),
    queryFn: () => fetchScheduleContainer(containerId),
    enabled: !!containerId,
  })

  const invalidateContainer = (): void => {
    void qc.invalidateQueries({ queryKey: scheduleKeys.container(containerId) })
    void qc.invalidateQueries({ queryKey: scheduleKeys.all })
  }

  // ── контейнеры ─────────────────────────────────────────────────────────
  const [newContainerName, setNewContainerName] = useState('')
  const createContainer = useMutation({
    mutationFn: () => createScheduleRequest({ groupId, name: newContainerName.trim() }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.containers(groupId) })
      setContainerId(created.id)
      setNewContainerName('')
      setNewContainerOpen(false)
      toast.success(t('containerCreated'))
    },
    onError: (e) => toast.error(tErr(apiErr(e).code)),
  })

  const activateContainer = useMutation({
    mutationFn: (id: string) => updateScheduleRequest(id, { isActive: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.containers(groupId) })
      toast.success(t('containerActivated'))
    },
    onError: (e) => toast.error(tErr(apiErr(e).code)),
  })

  // ── добавление пары ──────────────────────────────────────────────────────
  const [pairTeacher, setPairTeacher] = useState<PickedUser | null>(null)
  const pairForm = useForm<CreatePairInput>({
    resolver: zodResolver(CreatePairSchema),
    defaultValues: { weekType: 'BOTH', dayOfWeek: 1 },
  })
  useEffect(() => {
    pairForm.setValue('scheduleId', containerId)
  }, [containerId, pairForm])

  const createPair = useMutation({
    mutationFn: (input: CreatePairInput) => createPairRequest(input),
    onSuccess: () => {
      invalidateContainer()
      pairForm.reset({ scheduleId: containerId, weekType: 'BOTH', dayOfWeek: 1 })
      setPairTeacher(null)
      toast.success(t('pairCreated'))
    },
    onError: (e) => {
      const err = apiErr(e)
      if (err.code === 'CONFLICT') {
        const msgs = err.details?.map((d) => d.message).join('; ') ?? t('conflictGeneric')
        toast.error(t('conflictTitle'), { description: msgs })
      } else {
        toast.error(tErr(err.code))
      }
    },
  })

  const deletePair = useMutation({
    mutationFn: (id: string) => deletePairRequest(id),
    onSuccess: () => {
      invalidateContainer()
      setSelectedPair(null)
      toast.success(t('pairDeleted'))
    },
    onError: (e) => toast.error(tErr(apiErr(e).code)),
  })

  // ── создание замены ──────────────────────────────────────────────────────
  const [changeTeacher, setChangeTeacher] = useState<PickedUser | null>(null)
  const changeForm = useForm<CreateScheduleChangeInput>({
    resolver: zodResolver(CreateScheduleChangeSchema),
    defaultValues: { type: 'CANCELLED' },
  })
  const changeType = changeForm.watch('type')

  const createChange = useMutation({
    mutationFn: (input: CreateScheduleChangeInput) => createScheduleChangeRequest(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.all })
      changeForm.reset({ type: 'CANCELLED', pairId: selectedPair?.id })
      setChangeTeacher(null)
      toast.success(t('changeCreated'))
    },
    onError: (e) => toast.error(tErr(apiErr(e).code)),
  })

  const roomItems = rooms.data ?? []
  const pairs = container.data?.pairs ?? []

  // Клик по пустому слоту календаря → форма добавления с предзаполненным днём/временем.
  function onSlotClick(dayOfWeek: number, startTime: string): void {
    setSelectedPair(null)
    pairForm.reset({
      scheduleId: containerId,
      weekType: 'BOTH',
      dayOfWeek,
      startTime,
      endTime: addMinutes(startTime, 90),
      subject: '',
    })
    setPairTeacher(null)
  }

  // Клик по паре → панель деталей + замена.
  function onPairClick(p: Pair): void {
    setSelectedPair(p)
    changeForm.reset({ type: 'CANCELLED', pairId: p.id })
    setChangeTeacher(null)
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('manageTitle')}</h1>

      {/* Тулбар: группа + контейнер */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-3">
        <div className="flex min-w-52 flex-1 flex-col gap-1.5">
          <Label>{t('selectGroup')}</Label>
          {groups.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={groupId}
              onValueChange={(v) => {
                setGroupId(v)
                setSelectedPair(null)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('selectGroupPlaceholder')} />
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
        </div>

        {groupId && (
          <div className="flex min-w-52 flex-1 flex-col gap-1.5">
            <Label>{t('containers')}</Label>
            <div className="flex items-center gap-2">
              <Select value={containerId} onValueChange={setContainerId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('noContainers')} />
                </SelectTrigger>
                <SelectContent>
                  {(containers.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.isActive ? ` · ${t('active')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('createContainer')}
                onClick={() => setNewContainerOpen((v) => !v)}
              >
                <Plus className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}

        {groupId &&
          containerId &&
          !containers.data?.find((c) => c.id === containerId)?.isActive && (
            <Button
              type="button"
              variant="outline"
              loading={activateContainer.isPending}
              onClick={() => activateContainer.mutate(containerId)}
            >
              <Check className="size-4" aria-hidden />
              {t('activate')}
            </Button>
          )}
      </div>

      {/* Создание контейнера */}
      {groupId && newContainerOpen && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 duration-150 animate-in fade-in slide-in-from-top-1 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="cname">{t('newContainerName')}</Label>
            <Input
              id="cname"
              value={newContainerName}
              onChange={(e) => setNewContainerName(e.target.value)}
              placeholder={t('newContainerPlaceholder')}
            />
          </div>
          <Button
            type="button"
            loading={createContainer.isPending}
            disabled={newContainerName.trim().length === 0}
            onClick={() => createContainer.mutate()}
          >
            {t('createContainer')}
          </Button>
        </div>
      )}

      {!groupId ? (
        <EmptyState
          icon={<Layers className="size-6" aria-hidden />}
          title={t('pickGroupTitle')}
          description={t('pickGroupHint')}
        />
      ) : !containerId ? (
        <EmptyState
          icon={<CalendarPlus className="size-6" aria-hidden />}
          title={t('noContainers')}
          description={t('createContainerHint')}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* Календарь-редактор */}
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MousePointerClick className="size-3.5" aria-hidden />
              {t('editorHint')}
            </p>
            {container.isLoading ? (
              <Skeleton className="h-[28rem] w-full" />
            ) : (
              <ScheduleEditor
                pairs={pairs}
                selectedPairId={selectedPair?.id ?? null}
                onSlotClick={onSlotClick}
                onPairClick={onPairClick}
              />
            )}
          </div>

          {/* Боковая панель: пара (детали + замена) ИЛИ добавление */}
          <aside className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            {selectedPair ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold">{selectedPair.subject}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t(`day${selectedPair.dayOfWeek}`)} · {selectedPair.startTime}–
                      {selectedPair.endTime}
                      {selectedPair.weekType !== 'BOTH' &&
                        ` · ${t(`parity${selectedPair.weekType}`)}`}
                    </p>
                    {selectedPair.room && (
                      <p className="text-sm text-muted-foreground">{selectedPair.room.name}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={t('close')}
                    onClick={() => setSelectedPair(null)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  loading={deletePair.isPending}
                  onClick={() => {
                    if (window.confirm(t('deletePairConfirm'))) deletePair.mutate(selectedPair.id)
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t('deletePair')}
                </Button>

                <div className="my-1 border-t border-border" />

                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <CalendarPlus className="size-4" aria-hidden />
                  {t('createChange')}
                </h3>
                <form
                  onSubmit={changeForm.handleSubmit((v) => createChange.mutate(v))}
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('changeType')}</Label>
                    <Controller
                      control={changeForm.control}
                      name="type"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
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
                    <Label htmlFor="cdate">{t('date')}</Label>
                    <Input id="cdate" type="date" {...changeForm.register('date')} />
                    {changeForm.formState.errors.date && (
                      <p className="text-xs text-destructive">{t('required')}</p>
                    )}
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
                            <SelectTrigger>
                              <SelectValue placeholder={t('selectRoom')} />
                            </SelectTrigger>
                            <SelectContent>
                              {roomItems.map((r) => (
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
                    <div className="grid grid-cols-2 gap-2">
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

                  <Button type="submit" loading={createChange.isPending}>
                    {t('createChange')}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <h2 className="flex items-center gap-1.5 text-base font-semibold">
                  <Plus className="size-4" aria-hidden />
                  {t('addPair')}
                </h2>
                <form
                  onSubmit={pairForm.handleSubmit((v) => createPair.mutate(v))}
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="subject">{t('subject')}</Label>
                    <Input id="subject" {...pairForm.register('subject')} autoFocus />
                    {pairForm.formState.errors.subject && (
                      <p className="text-xs text-destructive">{t('required')}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label>{t('day')}</Label>
                      <Controller
                        control={pairForm.control}
                        name="dayOfWeek"
                        render={({ field }) => (
                          <Select
                            value={String(field.value)}
                            onValueChange={(v) => field.onChange(Number(v))}
                          >
                            <SelectTrigger>
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
                        control={pairForm.control}
                        name="weekType"
                        render={({ field }) => (
                          <Select value={field.value ?? 'BOTH'} onValueChange={field.onChange}>
                            <SelectTrigger>
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

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="start">{t('startTime')}</Label>
                      <Input id="start" type="time" {...pairForm.register('startTime')} />
                      {pairForm.formState.errors.startTime && (
                        <p className="text-xs text-destructive">{t('timeInvalid')}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="end">{t('endTime')}</Label>
                      <Input id="end" type="time" {...pairForm.register('endTime')} />
                      {pairForm.formState.errors.endTime && (
                        <p className="text-xs text-destructive">
                          {pairForm.formState.errors.endTime.message ?? t('timeInvalid')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>{t('room')}</Label>
                    <Controller
                      control={pairForm.control}
                      name="roomId"
                      render={({ field }) => (
                        <Select
                          value={field.value ?? ''}
                          onValueChange={(v) => field.onChange(v || null)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('roomOptional')} />
                          </SelectTrigger>
                          <SelectContent>
                            {roomItems.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>{tPeople('teacherOptional')}</Label>
                    <UserPicker
                      value={pairTeacher}
                      roleFilter={Role.TEACHER}
                      placeholder={tPeople('pickUser')}
                      onSelect={(u) => {
                        setPairTeacher(u)
                        pairForm.setValue('teacherId', u?.id ?? null)
                      }}
                    />
                  </div>

                  <Button type="submit" loading={createPair.isPending}>
                    <Plus className="size-4" aria-hidden />
                    {t('addPair')}
                  </Button>
                </form>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
