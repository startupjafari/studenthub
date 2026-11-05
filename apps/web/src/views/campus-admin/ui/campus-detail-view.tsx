'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Building2,
  Copy,
  ExternalLink,
  History,
  Layers,
  Pencil,
  Plus,
  Send,
  Trash2,
  Trees,
} from 'lucide-react'
import {
  activateCampusVersion,
  campusKeys,
  deleteCampus,
  deleteCampusBuilding,
  deleteCampusFloor,
  fetchCampusTree,
  fetchCampusVersions,
  restoreCampusVersion,
  type CampusBuildingRow,
  type CampusFloorRow,
} from '../../../entities/campus'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionPanel,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { CreateBuildingModal } from './create-building-modal'
import { AddFloorModal } from './add-floor-modal'
import { CopyFloorModal } from './copy-floor-modal'
import { PublishModal } from './publish-modal'

/**
 * Кампус для администратора: корпуса с этажами (каждый этаж открывается в редакторе),
 * публикация и история версий (§16.1, §20.5). Территория — отдельным редактором (Ф22.24).
 */
export function CampusDetailView({ campusId, basePath }: { campusId: string; basePath: string }) {
  const t = useTranslations('Campus')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creatingBuilding, setCreatingBuilding] = useState(false)
  const [addingFloorTo, setAddingFloorTo] = useState<CampusBuildingRow | null>(null)
  const [copying, setCopying] = useState<{
    building: CampusBuildingRow
    floor: CampusFloorRow
  } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const tree = useQuery({
    queryKey: campusKeys.tree(campusId),
    queryFn: () => fetchCampusTree(campusId),
  })
  const versions = useQuery({
    queryKey: campusKeys.versions(campusId),
    queryFn: () => fetchCampusVersions(campusId),
  })
  const fail = (e: unknown) => toast.error(tErr(toApiError(e).code))
  const refresh = () => void qc.invalidateQueries({ queryKey: campusKeys.all })

  const removeBuilding = useMutation({
    mutationFn: deleteCampusBuilding,
    onSuccess: refresh,
    onError: fail,
  })
  const removeFloor = useMutation({
    mutationFn: deleteCampusFloor,
    onSuccess: refresh,
    onError: fail,
  })
  const removeCampus = useMutation({
    mutationFn: () => deleteCampus(campusId),
    onSuccess: () => {
      refresh()
      router.push(basePath)
    },
    onError: fail,
  })
  const activate = useMutation({
    mutationFn: (versionId: string) => activateCampusVersion(campusId, versionId),
    onSuccess: () => {
      refresh()
      toast.success(t('versionActivated'))
    },
    onError: fail,
  })
  const restore = useMutation({
    mutationFn: (versionId: string) => restoreCampusVersion(campusId, versionId),
    onSuccess: (r) => {
      refresh()
      toast.success(t('versionRestored', { count: r.restored }))
    },
    onError: fail,
  })

  const back = () => router.push(basePath)

  if (tree.isPending) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader title={t('adminTitle')} onBack={back} backLabel={t('back')} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }
  if (!tree.data) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader title={t('adminTitle')} onBack={back} backLabel={t('back')} />
        <EmptyState icon={<Building2 className="size-6" aria-hidden />} title={t('notFound')} />
      </div>
    )
  }
  const c = tree.data
  const date = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={c.name}
        onBack={back}
        backLabel={t('back')}
        subtitle={
          c.publishedVersion
            ? t('publishedVersion', {
                number: c.publishedVersion.number,
                date: date(c.publishedVersion.publishedAt),
              })
            : t('notPublished')
        }
        actions={
          <>
            <Button asChild variant="outline" size="md">
              <Link href={`/campus-editor/site/${c.id}`} aria-label={t('site')}>
                <Trees aria-hidden />
                <span className="hidden sm:inline">{t('site')}</span>
              </Link>
            </Button>
            {c.publishedVersion && (
              <Button asChild variant="outline" size="md">
                <Link href={`/campus/${c.id}`} aria-label={t('openViewer')}>
                  <ExternalLink aria-hidden />
                  <span className="hidden sm:inline">{t('openViewer')}</span>
                </Link>
              </Button>
            )}
            <Button
              type="button"
              size="md"
              onClick={() => setPublishing(true)}
              disabled={c.buildings.length === 0}
            >
              <Send aria-hidden />
              {t('publish')}
            </Button>
          </>
        }
      />

      {/* Корпуса — ровной сеткой: карточки одной строки одной высоты, «Добавить этаж» прижат
          к низу, последняя ячейка — «Добавить корпус», чтобы сетка не оставалась с дырой. */}
      {c.buildings.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" aria-hidden />}
          title={t('noBuildings')}
          description={t('noBuildingsText')}
          action={
            <Button type="button" onClick={() => setCreatingBuilding(true)}>
              <Plus aria-hidden />
              {t('addBuilding')}
            </Button>
          }
        />
      ) : (
        <ul className="grid items-stretch gap-4 lg:grid-cols-2">
          {c.buildings.map((b) => (
            <li key={b.id} className="flex">
              <SectionPanel
                className="flex-1"
                bodyClassName="flex flex-1 flex-col gap-3"
                title={`${b.code ? `${b.code} · ` : ''}${b.name}`}
                subtitle={t('floorsCountLabel', { count: b.floors.length })}
                actions={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={t('deleteBuilding')}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      void confirm({
                        title: t('deleteBuildingConfirm', { name: b.name }),
                        destructive: true,
                      }).then((ok) => ok && removeBuilding.mutate(b.id))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                }
              >
                <ul className="flex flex-col">
                  {[...b.floors].reverse().map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Layers className="size-4" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {t('floorN', { label: f.label })}
                        </span>
                        {f.kind === 'technical' && (
                          <Badge variant="secondary">{t('technical')}</Badge>
                        )}
                      </span>
                      <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                        {t('revision', { n: f.plan?.revision ?? 0 })}
                      </span>
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/campus-editor/${f.id}`}>
                          <Pencil aria-hidden />
                          {t('edit')}
                        </Link>
                      </Button>
                      {b.floors.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={t('copyFloorTo')}
                          title={t('copyFloorTo')}
                          className="text-muted-foreground"
                          onClick={() => setCopying({ building: b, floor: f })}
                        >
                          <Copy aria-hidden />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label={t('deleteFloor')}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          void confirm({
                            title: t('deleteFloorConfirm', { label: f.label }),
                            destructive: true,
                          }).then((ok) => ok && removeFloor.mutate(f.id))
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => setAddingFloorTo(b)}
                >
                  <Plus aria-hidden />
                  {t('addFloor')}
                </Button>
              </SectionPanel>
            </li>
          ))}
          <li className="flex">
            <button
              type="button"
              onClick={() => setCreatingBuilding(true)}
              className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <Plus className="size-5" aria-hidden />
              {t('addBuilding')}
            </button>
          </li>
        </ul>
      )}

      <SectionPanel title={t('versions')} subtitle={t('versionsHint')} bodyClassName="py-0">
        {(versions.data ?? []).length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">{t('noVersions')}</p>
        ) : (
          <ul className="flex flex-col">
            {(versions.data ?? []).map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-b-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <History className="size-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-sm font-medium tabular-nums">
                    №{v.number}
                    {v.current && <Badge variant="success">{t('current')}</Badge>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[date(v.publishedAt), t('spacesCount', { count: v.spaces }), v.note]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <span className="flex gap-2">
                  {!v.current && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => activate.mutate(v.id)}
                    >
                      {t('makeCurrent')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void confirm({
                        title: t('restoreConfirm', { number: v.number }),
                        description: t('restoreHint'),
                      }).then((ok) => ok && restore.mutate(v.id))
                    }
                  >
                    {t('restoreDraft')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>

      {/* Удаление кампуса — строкой-карточкой внизу, как опасные действия в настройках. */}
      <Card className="flex-row items-center gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">{t('dangerZone')}</span>
          <span className="text-xs text-muted-foreground">{t('dangerZoneHint')}</span>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() =>
            void confirm({
              title: t('deleteCampusConfirm', { name: c.name }),
              destructive: true,
            }).then((ok) => ok && removeCampus.mutate())
          }
        >
          <Trash2 aria-hidden />
          {t('deleteCampus')}
        </Button>
      </Card>

      {creatingBuilding && (
        <CreateBuildingModal campusId={campusId} onClose={() => setCreatingBuilding(false)} />
      )}
      {addingFloorTo && (
        <AddFloorModal
          campusId={campusId}
          building={addingFloorTo}
          onClose={() => setAddingFloorTo(null)}
        />
      )}
      {copying && (
        <CopyFloorModal
          building={copying.building}
          source={copying.floor}
          onClose={() => setCopying(null)}
        />
      )}
      {publishing && <PublishModal tree={c} onClose={() => setPublishing(false)} />}
    </div>
  )
}
