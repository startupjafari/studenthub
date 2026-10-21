'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Cctv, MonitorPlay } from 'lucide-react'
import type { CameraStatusValue } from '@studenthub/shared-schemas'
import { Badge, EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  cameraKeys,
  fetchCameraSettings,
  fetchCameras,
  type Camera,
} from '../../../entities/camera'
import { fetchMe, userKeys } from '../../../entities/user'
import { CameraPlayer } from '../../../features/watch-camera'

// Столько камер можно смотреть одновременно — столько же разрешает сервер (MAX_ACTIVE_VIEWS).
const MAX_WATCHED = 4

const STATUS_BADGE: Record<CameraStatusValue, 'success' | 'secondary' | 'destructive' | 'outline'> =
  {
    ONLINE: 'success',
    OFFLINE: 'secondary',
    AUTH_FAILED: 'destructive',
    UNKNOWN: 'outline',
  }

/**
 * Стена камер (docs/PROJECT.md §3.10): список камер вуза и сетка до четырёх окон. Видео
 * идёт только в открытых окнах — закрыл окно, сессия закончилась, агент перестал отдавать
 * поток. Общая для охраны и администратора вуза.
 */
export function CameraWall() {
  const t = useTranslations('CameraWatch')
  const tCam = useTranslations('Cameras')
  const settings = useQuery({ queryKey: cameraKeys.settings(), queryFn: fetchCameraSettings })
  const cameras = useQuery({
    queryKey: cameraKeys.list(),
    queryFn: () => fetchCameras<Camera>(),
    // Состояние камер меняет агент — пусть список не застывает, пока охрана на посту.
    refetchInterval: 30_000,
  })
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const [watched, setWatched] = useState<string[]>([])

  if (settings.isPending || cameras.isPending) {
    return <Skeleton className="h-64 w-full rounded-xl" />
  }
  if (!settings.data?.enabled) {
    return (
      <EmptyState
        icon={<Cctv className="size-8" aria-hidden />}
        title={t('disabledTitle')}
        description={t('disabledDesc')}
      />
    )
  }
  const list = (cameras.data?.items ?? []).filter((c) => c.enabled)
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Cctv className="size-8" aria-hidden />}
        title={t('emptyTitle')}
        description={t('emptyDesc')}
      />
    )
  }

  const viewer = me.data ? `${me.data.lastName} ${me.data.firstName}` : ''
  const byId = new Map(list.map((c) => [c.id, c]))
  const open = watched.filter((id) => byId.has(id))

  function toggle(id: string): void {
    if (open.includes(id)) {
      setWatched(open.filter((w) => w !== id))
      return
    }
    if (open.length >= MAX_WATCHED) {
      toast.error(t('limit', { count: MAX_WATCHED }))
      return
    }
    setWatched([...open, id])
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-2" aria-label={t('listLabel')}>
        {list.map((camera) => {
          const active = open.includes(camera.id)
          return (
            <li key={camera.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => toggle(camera.id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{camera.name}</span>
                  {camera.room && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {camera.room.name}
                    </span>
                  )}
                </span>
                <Badge variant={STATUS_BADGE[camera.status]}>
                  {tCam(`statusState.${camera.status}`)}
                </Badge>
              </button>
            </li>
          )
        })}
      </ul>

      {open.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay className="size-8" aria-hidden />}
          title={t('pickTitle')}
          description={t('pickDesc', { count: MAX_WATCHED })}
        />
      ) : (
        <div className={cn('grid gap-3', open.length > 1 && 'md:grid-cols-2')}>
          {open.map((id) => {
            const camera = byId.get(id)!
            return (
              <CameraPlayer
                key={id}
                camera={camera}
                viewer={viewer}
                onClose={() => setWatched(open.filter((w) => w !== id))}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
