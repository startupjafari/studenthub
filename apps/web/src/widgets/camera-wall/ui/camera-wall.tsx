'use client'

import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Cctv, MonitorPlay } from 'lucide-react'
import type { CameraStatusValue } from '@studenthub/shared-schemas'
import { Badge, EmptyState, PageHeader, Skeleton, type PageHeaderProps } from '../../../shared/ui'
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
 *
 * Шапку страницы рисует сама стена: список камер стоит в ней, слева за заголовком, и
 * прокручивается вбок, когда камер много, — сетке остаётся вся высота экрана.
 */
export function CameraWall({ header }: { header: Omit<PageHeaderProps, 'nav'> }) {
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

  const shell = (body: ReactNode, nav?: ReactNode): ReactNode => (
    <div className="flex w-full min-h-0 flex-1 flex-col gap-6">
      <PageHeader {...header} nav={nav} />
      {body}
    </div>
  )

  if (settings.isPending || cameras.isPending) {
    return shell(<Skeleton fill className="min-h-64 rounded-xl" />)
  }
  if (!settings.data?.enabled) {
    return shell(
      <EmptyState
        icon={<Cctv className="size-8" aria-hidden />}
        title={t('disabledTitle')}
        description={t('disabledDesc')}
      />,
    )
  }
  const list = (cameras.data?.items ?? []).filter((c) => c.enabled)
  if (list.length === 0) {
    return shell(
      <EmptyState
        icon={<Cctv className="size-8" aria-hidden />}
        title={t('emptyTitle')}
        description={t('emptyDesc')}
      />,
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

  // Каждая плашка в одну строку и одной высоты: помещение идёт следом за названием, а не
  // второй строкой — иначе плашки с помещением выше остальных и полоса «пляшет».
  const tabs = (
    <ul className="flex w-max gap-2 py-1" aria-label={t('listLabel')}>
      {list.map((camera) => {
        const active = open.includes(camera.id)
        return (
          <li key={camera.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => toggle(camera.id)}
              className={cn(
                'flex h-9 items-center gap-2 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-muted',
              )}
            >
              <span className="font-medium">{camera.name}</span>
              {camera.room && (
                <span className="text-xs text-muted-foreground">{camera.room.name}</span>
              )}
              <Badge variant={STATUS_BADGE[camera.status]}>
                {tCam(`statusState.${camera.status}`)}
              </Badge>
            </button>
          </li>
        )
      })}
    </ul>
  )

  return shell(
    open.length === 0 ? (
      <EmptyState
        icon={<MonitorPlay className="size-8" aria-hidden />}
        title={t('pickTitle')}
        description={t('pickDesc', { count: MAX_WATCHED })}
      />
    ) : (
      <div className="grid content-start gap-3 md:grid-cols-2 xl:grid-cols-3">
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
    ),
    tabs,
  )
}
