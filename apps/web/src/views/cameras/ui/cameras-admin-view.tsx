'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Cctv, KeyRound, MonitorPlay, Pencil, Plus, Power, Server, Trash2 } from 'lucide-react'
import type { CameraStatusValue } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PromptDialog,
  SectionPanel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableText,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  cameraKeys,
  createCameraAgentRequest,
  deleteCameraAgentRequest,
  deleteCameraRequest,
  fetchCameraAgents,
  fetchCameraSettings,
  fetchCameras,
  rotateCameraAgentTokenRequest,
  updateCameraSettingsRequest,
  type AgentConnection,
  type CameraAdmin,
  type CameraAgentWithToken,
} from '../../../entities/camera'
import { AgentTokenModal } from './agent-token-modal'
import { CameraFormModal } from './camera-form-modal'

// Камеры вуза для администратора (docs/PROJECT.md §3.10): выключатель модуля, агенты в
// сети вуза и камеры за ними. Видео здесь нет — просмотр на отдельной странице (watch).

const CONNECTION_BADGE: Record<AgentConnection, 'success' | 'secondary' | 'outline'> = {
  ONLINE: 'success',
  OFFLINE: 'secondary',
  NEVER: 'outline',
}

const STATUS_BADGE: Record<CameraStatusValue, 'success' | 'secondary' | 'destructive' | 'outline'> =
  {
    ONLINE: 'success',
    OFFLINE: 'secondary',
    AUTH_FAILED: 'destructive',
    UNKNOWN: 'outline',
  }

const HIDE = {
  version: 'hidden md:table-cell',
  room: 'hidden md:table-cell',
  agent: 'hidden lg:table-cell',
  password: 'hidden lg:table-cell',
} as const

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function CamerasAdminView() {
  const t = useTranslations('Cameras')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  const settings = useQuery({ queryKey: cameraKeys.settings(), queryFn: fetchCameraSettings })
  const agents = useQuery({ queryKey: cameraKeys.agents(), queryFn: fetchCameraAgents })
  const cameras = useQuery({
    queryKey: cameraKeys.list(),
    queryFn: () => fetchCameras<CameraAdmin>(),
  })

  const [creatingAgent, setCreatingAgent] = useState(false)
  const [issued, setIssued] = useState<CameraAgentWithToken | null>(null)
  const [cameraForm, setCameraForm] = useState<{ camera?: CameraAdmin } | null>(null)

  const invalidate = (): void => void qc.invalidateQueries({ queryKey: cameraKeys.all })
  const onError = (e: unknown): void => void toast.error(tErr(errCode(e)))

  const settingsMut = useMutation({
    mutationFn: updateCameraSettingsRequest,
    onSuccess: (data) => {
      invalidate()
      toast.success(data.enabled ? t('enabledToast') : t('disabledToast'))
    },
    onError,
  })
  const createAgentMut = useMutation({
    mutationFn: (name: string) => createCameraAgentRequest({ name }),
    onSuccess: (data) => {
      invalidate()
      setIssued(data)
    },
    onError,
  })
  const rotateMut = useMutation({
    mutationFn: rotateCameraAgentTokenRequest,
    onSuccess: (data) => {
      invalidate()
      setIssued(data)
    },
    onError,
  })
  const deleteAgentMut = useMutation({
    mutationFn: deleteCameraAgentRequest,
    onSuccess: () => {
      invalidate()
      toast.success(t('agentDeleted'))
    },
    onError,
  })
  const deleteCameraMut = useMutation({
    mutationFn: deleteCameraRequest,
    onSuccess: () => {
      invalidate()
      toast.success(t('cameraDeleted'))
    },
    onError,
  })

  const enabled = settings.data?.enabled ?? false
  const agentList = agents.data ?? []
  const cameraList = cameras.data?.items ?? []

  async function toggleModule(): Promise<void> {
    if (enabled) {
      const ok = await confirm({
        title: t('disableConfirmTitle'),
        description: t('disableConfirmDesc'),
        confirmLabel: t('disable'),
        destructive: true,
      })
      if (!ok) return
    }
    settingsMut.mutate(!enabled)
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('adminTitle')}
        subtitle={t('adminSubtitle')}
        actions={
          settings.isPending ? (
            <Skeleton className="h-9 w-40" />
          ) : (
            <Button
              type="button"
              variant={enabled ? 'outline' : 'default'}
              loading={settingsMut.isPending}
              onClick={() => void toggleModule()}
            >
              <Power className="size-4" aria-hidden />
              {enabled ? t('disable') : t('enable')}
            </Button>
          )
        }
      />

      <SectionPanel
        title={t('agentsTitle')}
        subtitle={t('agentsSubtitle')}
        bodyClassName="px-0 py-0"
        actions={
          <Button type="button" size="sm" onClick={() => setCreatingAgent(true)}>
            <Plus className="size-4" aria-hidden />
            {t('addAgent')}
          </Button>
        }
      >
        {agents.isPending ? (
          <div className="p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : agentList.length === 0 ? (
          <EmptyState
            icon={<Server className="size-8" aria-hidden />}
            title={t('agentsEmptyTitle')}
            description={t('agentsEmptyDesc')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('connection')}</TableHead>
                <TableHead className={HIDE.version}>{t('version')}</TableHead>
                <TableHead numeric>{t('camerasCount')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agentList.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">
                    <TableText value={agent.name} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={CONNECTION_BADGE[agent.connection]}>
                      {t(`connectionState.${agent.connection}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn(HIDE.version, 'text-muted-foreground')}>
                    {agent.version ? <TableText value={agent.version} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{agent.cameraCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label={t('rotateToken')}
                        title={t('rotateToken')}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('rotateConfirmTitle'),
                            description: t('rotateConfirmDesc', { name: agent.name }),
                            confirmLabel: t('rotateToken'),
                            destructive: true,
                          })
                          if (ok) rotateMut.mutate(agent.id)
                        }}
                      >
                        <KeyRound className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label={t('deleteAgent')}
                        title={t('deleteAgent')}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('deleteAgentConfirmTitle'),
                            description: t('deleteAgentConfirmDesc', {
                              name: agent.name,
                              count: agent.cameraCount,
                            }),
                            destructive: true,
                          })
                          if (ok) deleteAgentMut.mutate(agent.id)
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionPanel>

      <SectionPanel
        title={t('camerasTitle')}
        subtitle={t('camerasSubtitle')}
        bodyClassName="px-0 py-0"
        actions={
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {enabled && cameraList.length > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/university-admin/cameras/watch">
                  <MonitorPlay className="size-4" aria-hidden />
                  {t('watch')}
                </Link>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={agentList.length === 0}
              title={agentList.length === 0 ? t('addAgentFirst') : undefined}
              onClick={() => setCameraForm({})}
            >
              <Plus className="size-4" aria-hidden />
              {t('addCamera')}
            </Button>
          </div>
        }
      >
        {cameras.isPending ? (
          <div className="p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : cameraList.length === 0 ? (
          <EmptyState
            icon={<Cctv className="size-8" aria-hidden />}
            title={t('camerasEmptyTitle')}
            description={agentList.length === 0 ? t('addAgentFirst') : t('camerasEmptyDesc')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead className={HIDE.room}>{t('room')}</TableHead>
                <TableHead className={HIDE.agent}>{t('agent')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead className={HIDE.password}>{t('credentials')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cameraList.map((camera) => (
                <TableRow key={camera.id} className={cn(!camera.enabled && 'opacity-60')}>
                  <TableCell className="font-medium">
                    <TableText value={camera.name} />
                  </TableCell>
                  <TableCell className={cn(HIDE.room, 'text-muted-foreground')}>
                    {camera.room ? <TableText value={camera.room.name} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell className={cn(HIDE.agent, 'text-muted-foreground')}>
                    <TableText value={camera.agent.name} />
                  </TableCell>
                  <TableCell>
                    {camera.enabled ? (
                      <Badge variant={STATUS_BADGE[camera.status]}>
                        {t(`statusState.${camera.status}`)}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t('cameraDisabled')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className={cn(HIDE.password, 'text-muted-foreground')}>
                    {camera.hasCredentials ? t('credentialsSet') : t('credentialsNone')}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label={t('editCamera')}
                        title={t('editCamera')}
                        onClick={() => setCameraForm({ camera })}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label={t('deleteCamera')}
                        title={t('deleteCamera')}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('deleteCameraConfirmTitle'),
                            description: t('deleteCameraConfirmDesc', { name: camera.name }),
                            destructive: true,
                          })
                          if (ok) deleteCameraMut.mutate(camera.id)
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionPanel>

      <PromptDialog
        open={creatingAgent}
        title={t('addAgent')}
        placeholder={t('agentNamePlaceholder')}
        required
        submitLabel={t('add')}
        cancelLabel={tCommon('cancel')}
        onSubmit={(name) => {
          setCreatingAgent(false)
          createAgentMut.mutate(name.trim())
        }}
        onClose={() => setCreatingAgent(false)}
      />
      {issued && (
        <AgentTokenModal
          agentName={issued.agent.name}
          token={issued.token}
          onClose={() => setIssued(null)}
        />
      )}
      {cameraForm && (
        <CameraFormModal
          agents={agentList}
          camera={cameraForm.camera}
          onClose={() => setCameraForm(null)}
        />
      )}
    </div>
  )
}
