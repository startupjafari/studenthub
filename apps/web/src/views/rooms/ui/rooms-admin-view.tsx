'use client'

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { DoorClosed, Printer, QrCode, RefreshCw, Trash2 } from 'lucide-react'
import {
  CreateRoomSchema,
  ROOM_KINDS,
  isAcademicRoomKind,
  type CreateRoomInput,
  type RoomKind,
} from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import {
  createRoomRequest,
  deleteRoomRequest,
  fetchRooms,
  issueRoomQrRequest,
  roomKeys,
  rotateRoomQrRequest,
  type Room,
  type RoomQr,
} from '../../../entities/room'
import { RoomQrSheet, type QrSheetLayout } from './room-qr-sheet'
import { formatRoomCode } from '../lib/format-code'

// Ф16: экран администратора вуза — помещения и печатные QR над дверью.
// До этой задачи помещения создавались только через API: экрана не было вовсе,
// хотя POST /rooms существовал с Ф5.

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function RoomsAdminView() {
  const t = useTranslations('Rooms')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  // Что уходит в печать. Пусто — печатать нечего, лист не рендерим.
  const [sheet, setSheet] = useState<RoomQr[]>([])
  // Раскладка печати: по наклейке на лист или четыре под разрезание (Ф16).
  const [layout, setLayout] = useState<QrSheetLayout>('full')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const rooms = useQuery({ queryKey: roomKeys.list(), queryFn: () => fetchRooms() })

  const form = useForm<CreateRoomInput>({
    resolver: zodResolver(CreateRoomSchema),
    // universityId не отправляем: для администратора вуза сервер берёт его из JWT (§6.1).
    defaultValues: { kind: 'AUDITORIUM' },
  })
  const kind = form.watch('kind') ?? 'AUDITORIUM'
  const academic = isAcademicRoomKind(kind)

  const createMut = useMutation({
    mutationFn: createRoomRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      form.reset({ kind })
      toast.success(t('created'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const deleteMut = useMutation({
    mutationFn: deleteRoomRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => {
      // Помещение занято в расписании — удалять нельзя (иначе пары «потеряют» аудиторию).
      const code = errCode(e)
      toast.error(code === 'CONFLICT' ? t('deleteBlocked') : tErr(code))
    },
  })

  const printMut = useMutation({
    mutationFn: issueRoomQrRequest,
    onSuccess: (items) => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      setSheet(items)
      // Даём React отрисовать лист до вызова печати — иначе печатается пустая страница.
      requestAnimationFrame(() => window.print())
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const rotateMut = useMutation({
    mutationFn: rotateRoomQrRequest,
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      setSheet([item])
      toast.success(t('rotated'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const items = rooms.data ?? []
  const allSelected = items.length > 0 && selected.size === items.length

  const grouped = useMemo(() => {
    // Группируем по корпусу: наклейки печатают и расклеивают корпусом/этажом.
    const map = new Map<string, Room[]>()
    for (const room of items) {
      const key = room.building ?? ''
      map.set(key, [...(map.get(key) ?? []), room])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [items])

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /**
   * Смена назначения меняет набор полей формы. react-hook-form сохраняет значения
   * размонтированных инпутов, поэтому без явной очистки вместимость от аудитории уезжала
   * в библиотеку (в UI поля уже не видно, а значение отправляется).
   */
  const changeKind = (value: RoomKind): void => {
    form.setValue('kind', value)
    if (isAcademicRoomKind(value)) {
      form.setValue('openHours', undefined)
      form.setValue('phone', undefined)
    } else {
      form.setValue('capacity', undefined)
    }
  }

  const rotate = async (room: Room): Promise<void> => {
    // Перевыпуск обесценивает уже расклеенные наклейки — спрашиваем явно.
    const ok = await confirm({
      title: t('rotateConfirmTitle'),
      description: t('rotateConfirmDesc', { room: room.name }),
      confirmLabel: t('rotateConfirmAction'),
      destructive: true,
    })
    if (ok) rotateMut.mutate(room.id)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="sh-no-print flex flex-col gap-6">
        <PageHeader title={t('adminTitle')} subtitle={t('adminDescription')} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('addRoom')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit(
                (v) => createMut.mutate(v),
                // Без этого отказ валидации был бы молчаливым: кнопка «Добавить» ничего
                // не делает, а под полем ошибки нет (все поля, кроме названия, опциональны).
                () => toast.error(t('checkFields')),
              )}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="room-name">{t('name')}</Label>
                <Input
                  id="room-name"
                  placeholder={t('namePlaceholder')}
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">{t('nameRequired')}</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="room-kind">{t('kindLabel')}</Label>
                <Select value={kind} onValueChange={(v) => changeKind(v as RoomKind)}>
                  <SelectTrigger id="room-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROOM_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="room-building">{t('building')}</Label>
                  <Input id="room-building" {...form.register('building')} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="room-floor">{t('floor')}</Label>
                  <Input
                    id="room-floor"
                    type="number"
                    {...form.register('floor', {
                      setValueAs: (v) => (v === '' ? undefined : Number(v)),
                    })}
                  />
                </div>
              </div>

              {/* Учебным помещениям нужна вместимость, остальным — часы работы и контакт. */}
              {academic ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="room-capacity">{t('capacity')}</Label>
                  <Input
                    id="room-capacity"
                    type="number"
                    {...form.register('capacity', {
                      setValueAs: (v) => (v === '' ? undefined : Number(v)),
                    })}
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="room-hours">{t('openHours')}</Label>
                    <Input
                      id="room-hours"
                      placeholder={t('openHoursPlaceholder')}
                      {...form.register('openHours')}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="room-phone">{t('phone')}</Label>
                    <Input id="room-phone" {...form.register('phone')} />
                  </div>
                </>
              )}

              <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="room-info">{t('info')}</Label>
                <Input
                  id="room-info"
                  placeholder={t('infoPlaceholder')}
                  {...form.register('info')}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit" loading={createMut.isPending}>
                  {t('add')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">{t('listTitle')}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Раскладка выбирается до печати: браузер печатает то, что отрисовано. */}
              <div
                role="group"
                aria-label={t('layoutLabel')}
                className="flex items-center rounded-md border border-border p-0.5"
              >
                <Button
                  variant={layout === 'full' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={layout === 'full'}
                  onClick={() => setLayout('full')}
                >
                  {t('layoutFull')}
                </Button>
                <Button
                  variant={layout === 'compact' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={layout === 'compact'}
                  onClick={() => setLayout('compact')}
                >
                  {t('layoutCompact')}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={selected.size === 0}
                loading={printMut.isPending}
                onClick={() => printMut.mutate([...selected])}
              >
                <Printer className="size-4" aria-hidden />
                {t('printSelected', { count: selected.size })}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {rooms.isPending && <Skeleton className="h-40 w-full" />}

            {!rooms.isPending && items.length === 0 && (
              <EmptyState
                icon={<DoorClosed className="size-8" aria-hidden />}
                title={t('emptyTitle')}
                description={t('emptyDesc')}
              />
            )}

            {items.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) =>
                    setSelected(v ? new Set(items.map((r) => r.id)) : new Set())
                  }
                />
                {t('selectAll')}
              </label>
            )}

            {grouped.map(([building, list]) => (
              <div key={building} className="flex flex-col gap-2">
                {building && (
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t('buildingValue', { value: building })}
                  </p>
                )}
                {list.map((room) => (
                  <div
                    key={room.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-border px-4 py-3"
                  >
                    <Checkbox
                      checked={selected.has(room.id)}
                      onCheckedChange={() => toggle(room.id)}
                      aria-label={t('selectRoom', { room: room.name })}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{room.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          t(`kind.${room.kind}`),
                          room.floor !== null ? t('floorValue', { value: room.floor }) : null,
                          room.capacity !== null
                            ? t('capacityValue', { value: room.capacity })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>

                    {room.qrCode ? (
                      <Badge variant="secondary" className="font-mono">
                        {formatRoomCode(room.qrCode)}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t('noQr')}</Badge>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      loading={printMut.isPending && printMut.variables?.[0] === room.id}
                      onClick={() => printMut.mutate([room.id])}
                    >
                      <QrCode className="size-4" aria-hidden />
                      {t('print')}
                    </Button>
                    {room.qrCode && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('rotate')}
                        onClick={() => void rotate(room)}
                      >
                        <RefreshCw className="size-4" aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('delete')}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t('deleteConfirmTitle'),
                          description: t('deleteConfirmDesc', { room: room.name }),
                          destructive: true,
                        })
                        if (ok) deleteMut.mutate(room.id)
                      }}
                    >
                      <Trash2 className="size-4 text-destructive" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Лист для печати: на экране скрыт, при печати — единственное, что попадает на бумагу. */}
      {sheet.length > 0 && <RoomQrSheet items={sheet} layout={layout} />}
    </div>
  )
}
