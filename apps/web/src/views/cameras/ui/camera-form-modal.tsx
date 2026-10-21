'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { CreateCameraSchema, type CameraCredentialsInput } from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { RoomSelect } from '../../../entities/room'
import {
  cameraKeys,
  createCameraRequest,
  updateCameraRequest,
  type CameraAdmin,
  type CameraAgent,
} from '../../../entities/camera'

// Пароль в форме — отдельные поля, а не часть общей схемы: при правке прежний пароль не
// приходит с сервера, и «оставить как есть» — это отсутствие поля, а не пустая строка.
const FormSchema = CreateCameraSchema.omit({ credentials: true }).extend({
  username: z.string().trim().max(100).optional(),
  password: z.string().max(200).optional(),
})
type FormValues = z.infer<typeof FormSchema>

/** Что делать с паролем при сохранении. При создании — только `set` или ничего. */
type CredentialsMode = 'keep' | 'set' | 'clear'

interface Props {
  agents: CameraAgent[]
  /** Задано — правка этой камеры. */
  camera?: CameraAdmin
  onClose: () => void
}

function errInfo(e: unknown): { code: string; agentNotReady: boolean } {
  const err = e as { code?: string; details?: { field?: string }[] }
  return {
    code: err.code ?? 'INTERNAL_ERROR',
    agentNotReady: err.code === 'CONFLICT' && !!err.details?.some((d) => d.field === 'agentId'),
  }
}

export function CameraFormModal({ agents, camera, onClose }: Props) {
  const t = useTranslations('Cameras')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [mode, setMode] = useState<CredentialsMode>('keep')
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: camera
      ? {
          agentId: camera.agent.id,
          name: camera.name,
          streamUrl: camera.streamUrl,
          roomId: camera.room?.id ?? null,
        }
      : { agentId: agents[0]?.id ?? '', roomId: null },
  })
  const agentId = form.watch('agentId')
  const agent = agents.find((a) => a.id === agentId)
  const settingPassword = credentialsOpen && mode !== 'clear'

  const mut = useMutation({
    mutationFn: (v: FormValues) => {
      const credentials: CameraCredentialsInput | undefined =
        settingPassword && v.username && v.password
          ? { username: v.username, password: v.password }
          : undefined
      if (camera) {
        return updateCameraRequest(camera.id, {
          name: v.name,
          streamUrl: v.streamUrl,
          roomId: v.roomId ?? null,
          ...(mode === 'clear' ? { credentials: null } : credentials ? { credentials } : {}),
        })
      }
      return createCameraRequest({
        agentId: v.agentId,
        name: v.name,
        streamUrl: v.streamUrl,
        roomId: v.roomId ?? null,
        ...(credentials ? { credentials } : {}),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cameraKeys.all })
      toast.success(camera ? t('cameraUpdated') : t('cameraCreated'))
      onClose()
    },
    onError: (e) => {
      const { code, agentNotReady } = errInfo(e)
      toast.error(agentNotReady ? t('agentNotReady') : tErr(code))
    },
  })

  return (
    <Modal onClose={onClose} title={camera ? t('editCamera') : t('addCamera')} size="lg">
      <form
        onSubmit={form.handleSubmit(
          (v) => {
            // Пароль начали вводить, но бросили — не молчим: иначе камера сохранилась бы
            // без пароля, а админ думал бы, что с ним.
            if (settingPassword && (!v.username || !v.password)) {
              toast.error(t('credentialsIncomplete'))
              return
            }
            mut.mutate(v)
          },
          () => toast.error(t('checkFields')),
        )}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="camera-name">{t('name')}</Label>
            <Input
              id="camera-name"
              autoFocus
              placeholder={t('namePlaceholder')}
              aria-invalid={!!form.formState.errors.name}
              {...form.register('name')}
            />
            <FieldError>{form.formState.errors.name ? t('nameRequired') : null}</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="camera-agent">{t('agent')}</Label>
            {/* Камеру не перевесить на другого агента: её пароль запечатан ключом этого. */}
            <Select
              value={agentId}
              onValueChange={(v) => form.setValue('agentId', v)}
              disabled={!!camera}
            >
              <SelectTrigger id="camera-agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="camera-url">{t('streamUrl')}</Label>
          <Input
            id="camera-url"
            placeholder="rtsp://10.0.0.5:554/Streaming/Channels/102"
            className="font-mono text-xs"
            aria-invalid={!!form.formState.errors.streamUrl}
            {...form.register('streamUrl')}
          />
          <FieldError>{form.formState.errors.streamUrl?.message ?? null}</FieldError>
          <p className="text-xs text-muted-foreground">{t('streamUrlHint')}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="camera-room">{t('room')}</Label>
          <RoomSelect
            id="camera-room"
            value={form.watch('roomId') ?? null}
            onChange={(v) => form.setValue('roomId', v)}
            initialLabel={camera?.room?.name ?? null}
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{t('credentials')}</p>
            <p className="text-xs text-muted-foreground">
              {camera?.hasCredentials && mode !== 'clear'
                ? t('credentialsSet')
                : mode === 'clear'
                  ? t('credentialsWillClear')
                  : t('credentialsNone')}
            </p>
          </div>
          {!credentialsOpen ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setMode('set')
                  setCredentialsOpen(true)
                }}
              >
                {camera?.hasCredentials ? t('changePassword') : t('setPassword')}
              </Button>
              {camera?.hasCredentials && mode !== 'clear' && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode('clear')}>
                  {t('clearPassword')}
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="camera-username">{t('username')}</Label>
                  <Input id="camera-username" autoComplete="off" {...form.register('username')} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="camera-password">{t('password')}</Label>
                  <Input
                    id="camera-password"
                    type="password"
                    autoComplete="new-password"
                    {...form.register('password')}
                  />
                </div>
              </div>
              {agent && !agent.ready && (
                <p className="text-xs text-warning">{t('agentNotReady')}</p>
              )}
              <p className="text-xs text-muted-foreground">{t('credentialsHint')}</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={mut.isPending}>
            {camera ? t('save') : t('add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
