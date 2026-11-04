'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Building2,
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
} from '../../../entities/campus'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { CreateBuildingModal } from './create-building-modal'
import { AddFloorModal } from './add-floor-modal'
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

  if (tree.isPending) {
    return (
      <div className="flex w-full flex-col gap-4">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    )
  }
  if (!tree.data) {
    return <EmptyState icon={<Building2 className="size-6" aria-hidden />} title={t('notFound')} />
  }
  const c = tree.data
  const date = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title={c.name}
        subtitle={
          c.publishedVersion
            ? t('publishedVersion', {
                number: c.publishedVersion.number,
                date: date(c.publishedVersion.publishedAt),
              })
            : t('notPublished')
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/campus-editor/site/${c.id}`}>
                <Trees aria-hidden />
                {t('site')}
              </Link>
            </Button>
            {c.publishedVersion && (
              <Button asChild variant="outline">
                <Link href={`/campus/${c.id}`}>
                  <ExternalLink aria-hidden />
                  {t('openViewer')}
                </Link>
              </Button>
            )}
            <Button
              type="button"
              onClick={() => setPublishing(true)}
              disabled={c.buildings.length === 0}
            >
              <Send aria-hidden />
              {t('publish')}
            </Button>
          </div>
        }
      />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t('buildings')}</h2>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setCreatingBuilding(true)}
          >
            <Plus aria-hidden />
            {t('addBuilding')}
          </Button>
        </div>
        {c.buildings.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" aria-hidden />}
            title={t('noBuildings')}
            description={t('noBuildingsText')}
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {c.buildings.map((b) => (
              <li key={b.id}>
                <Card className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold">
                        {b.code ? `${b.code} · ` : ''}
                        {b.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t('floorsCountLabel', { count: b.floors.length })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={t('deleteBuilding')}
                      onClick={() =>
                        void confirm({
                          title: t('deleteBuildingConfirm', { name: b.name }),
                          destructive: true,
                        }).then((ok) => ok && removeBuilding.mutate(b.id))
                      }
                    >
                      <Trash2 className="text-destructive" aria-hidden />
                    </Button>
                  </div>
                  <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                    {[...b.floors].reverse().map((f) => (
                      <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                        <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {t('floorN', { label: f.label })}
                          {f.kind === 'technical' && (
                            <Badge variant="secondary" className="ml-2">
                              {t('technical')}
                            </Badge>
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={t('deleteFloor')}
                          onClick={() =>
                            void confirm({
                              title: t('deleteFloorConfirm', { label: f.label }),
                              destructive: true,
                            }).then((ok) => ok && removeFloor.mutate(f.id))
                          }
                        >
                          <Trash2 className="text-muted-foreground" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setAddingFloorTo(b)}
                  >
                    <Plus aria-hidden />
                    {t('addFloor')}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <History className="size-4 text-muted-foreground" aria-hidden />
          {t('versions')}
        </h2>
        {(versions.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noVersions')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
            {(versions.data ?? []).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-sm font-semibold tabular-nums">№{v.number}</span>
                {v.current && <Badge variant="success">{t('current')}</Badge>}
                <span className="text-sm text-muted-foreground">{date(v.publishedAt)}</span>
                <span className="text-sm text-muted-foreground">
                  {t('spacesCount', { count: v.spaces })}
                </span>
                {v.note && <span className="min-w-0 flex-1 truncate text-sm">{v.note}</span>}
                <span className="ml-auto flex gap-2">
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
      </section>

      <div>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive"
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
      </div>

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
      {publishing && <PublishModal tree={c} onClose={() => setPublishing(false)} />}
    </div>
  )
}
