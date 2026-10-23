'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  CreateRoomSchema,
  ROOM_KINDS,
  isAcademicRoomKind,
  type CreateRoomInput,
  type RoomKind,
} from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  PhoneInput,
  isCompletePhone,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { OPTIONAL_TEXT } from '../../../shared/lib'
import { createRoomRequest, roomKeys, updateRoomRequest, type Room } from '../../../entities/room'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface Props {
  onClose: () => void
  /** Задано — правка этого помещения (часы работы и телефон печатаются на наклейке). */
  room?: Room
}

// Создание и правка помещения. Форма из семи полей занимала верх страницы постоянно, хотя
// помещения заводят при настройке вуза, а ходят на этот экран печатать наклейки.
export function CreateRoomModal({ onClose, room }: Props) {
  const t = useTranslations('Rooms')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const form = useForm<CreateRoomInput>({
    resolver: zodResolver(CreateRoomSchema),
    // universityId не отправляем: для администратора вуза сервер берёт его из JWT (§6.1).
    defaultValues: room
      ? {
          name: room.name,
          kind: room.kind,
          building: room.building ?? undefined,
          floor: room.floor ?? undefined,
          capacity: room.capacity ?? undefined,
          openHours: room.openHours ?? undefined,
          phone: room.phone ?? undefined,
          info: room.info ?? undefined,
        }
      : { kind: 'AUDITORIUM' },
  })
  const kind = form.watch('kind') ?? 'AUDITORIUM'
  const academic = isAcademicRoomKind(kind)

  // Смена назначения меняет набор полей — чужие значения не должны утекать в запрос.
  function changeKind(next: RoomKind): void {
    form.setValue('kind', next)
    if (isAcademicRoomKind(next)) {
      form.setValue('openHours', undefined)
      form.setValue('phone', undefined)
    } else {
      form.setValue('capacity', undefined)
    }
  }

  const createMut = useMutation({
    mutationFn: (v: CreateRoomInput) =>
      room
        ? // Правка — явные null вместо пустых полей: иначе стёртые часы работы или телефон
          // остались бы в базе и на напечатанной наклейке.
          updateRoomRequest(room.id, {
            name: v.name,
            kind: v.kind,
            building: v.building ?? null,
            floor: v.floor ?? null,
            capacity: v.capacity ?? null,
            openHours: v.openHours ?? null,
            phone: v.phone ?? null,
            info: v.info ?? null,
          })
        : createRoomRequest(v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      toast.success(room ? t('updated') : t('created'))
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  return (
    <Modal onClose={onClose} title={room ? t('editRoom') : t('addRoom')} size="lg">
      <form
        onSubmit={form.handleSubmit(
          (v) => createMut.mutate(v),
          // Без этого отказ валидации был бы молчаливым: кнопка ничего не делает,
          // а под полем ошибки нет (все поля, кроме названия, опциональны).
          () => toast.error(t('checkFields')),
        )}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-name">{t('name')}</Label>
            <Input
              id="room-name"
              autoFocus
              placeholder={t('namePlaceholder')}
              aria-invalid={!!form.formState.errors.name}
              {...form.register('name')}
            />
            <FieldError>{form.formState.errors.name ? t('nameRequired') : null}</FieldError>
          </div>

          <div className="flex flex-col gap-1.5">
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
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-building">{t('building')}</Label>
            <Input id="room-building" {...form.register('building', OPTIONAL_TEXT)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-floor">{t('floor')}</Label>
            <Input
              id="room-floor"
              type="number"
              {...form.register('floor', {
                setValueAs: (v) => (v === '' ? undefined : Number(v)),
              })}
            />
          </div>
          {/* Учебным помещениям нужна вместимость, остальным — часы работы и контакт. */}
          {academic && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-capacity">{t('capacity')}</Label>
              <Input
                id="room-capacity"
                type="number"
                {...form.register('capacity', {
                  setValueAs: (v) => (v === '' ? undefined : Number(v)),
                })}
              />
            </div>
          )}
        </div>

        {!academic && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-hours">{t('openHours')}</Label>
              <Input
                id="room-hours"
                placeholder={t('openHoursPlaceholder')}
                {...form.register('openHours', OPTIONAL_TEXT)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-phone">{t('phone')}</Label>
              <Controller
                control={form.control}
                name="phone"
                rules={{ validate: (v) => !v || isCompletePhone(v) || tCommon('phoneIncomplete') }}
                render={({ field }) => (
                  <PhoneInput
                    id="room-phone"
                    value={field.value}
                    onChange={(v) => field.onChange(v || undefined)}
                    onBlur={field.onBlur}
                    aria-invalid={!!form.formState.errors.phone}
                  />
                )}
              />
              <FieldError>{form.formState.errors.phone?.message}</FieldError>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="room-info">{t('info')}</Label>
          <Input
            id="room-info"
            placeholder={t('infoPlaceholder')}
            {...form.register('info', OPTIONAL_TEXT)}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={createMut.isPending}>
            {room ? t('save') : t('add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
