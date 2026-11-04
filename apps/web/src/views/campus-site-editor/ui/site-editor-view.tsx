'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Role } from '@studenthub/shared-types'
import { ArrowLeft, CircleAlert, Cloud, CloudOff, Loader2, Redo2, Undo2 } from 'lucide-react'
import { emptyFloorPlan, type BuildingTransform } from '@studenthub/campus-core'
import {
  campusKeys,
  fetchCampusSite,
  fetchCampusTree,
  saveCampusSite,
  updateCampusBuilding,
  type CampusSite,
  type CampusTree,
} from '../../../entities/campus'
import { fetchMe, userKeys } from '../../../entities/user'
import {
  SITE_TOOLS,
  SiteCanvas,
  SiteProperties,
  SiteStore,
  SiteToolbar,
  useSite,
  type SiteSaveState,
} from '../../../features/campus-site-editor'
import { CampusScene3D, type SceneFloor } from '../../../widgets/campus-3d'
import { Button, EmptyState, PageLoader, SegmentedTabs } from '../../../shared/ui'
import { cn, toApiError } from '../../../shared/lib'

const SAVE_DELAY_MS = 1500
const RETRY_MS = 5000

function backHref(role: Role | undefined, campusId: string): string {
  if (role === Role.UNIVERSITY_MODERATOR) return `/moderator/university/campus/${campusId}`
  if (role === Role.UNIVERSITY_ADMIN) return `/university-admin/campus/${campusId}`
  return '/'
}

/**
 * Редактор территории (docs/CAMPUS_BUILDER.md §14): граница, дорожки, дороги, газоны,
 * парковки, площадки, деревья, ворота, надписи и расстановка корпусов. Территорию рисуют с
 * нуля (подложек нет — решение владельца). Документ сохраняется сам с ревизией, корпус —
 * своим запросом при переносе.
 */
export function SiteEditorView({ campusId }: { campusId: string }) {
  const t = useTranslations('CampusSite')
  const tree = useQuery({
    queryKey: campusKeys.tree(campusId),
    queryFn: () => fetchCampusTree(campusId),
  })
  const site = useQuery({
    queryKey: campusKeys.site(campusId),
    queryFn: () => fetchCampusSite(campusId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  if (tree.isPending || site.isPending) return <PageLoader label={t('loading')} />
  if (!tree.data || !site.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState icon={<CircleAlert className="size-6" aria-hidden />} title={t('notFound')} />
      </div>
    )
  }
  return <Editor tree={tree.data} site={site.data} />
}

function Editor({ tree, site }: { tree: CampusTree; site: CampusSite }) {
  const t = useTranslations('CampusSite')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const [store] = useState(
    () =>
      new SiteStore(
        site.document,
        site.revision,
        tree.buildings.map((b) => ({
          id: b.id,
          name: b.name,
          code: b.code,
          outline: b.outline,
          transform: b.transform,
        })),
      ),
  )
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const saveState = useSite(store, (s) => s.saveState)
  const canUndo = useSite(store, (s) => s.canUndo)
  const canRedo = useSite(store, (s) => s.canRedo)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef(false)

  const save = useCallback(async (): Promise<void> => {
    const s = store.getState()
    if (saving.current || (s.saveState !== 'dirty' && s.saveState !== 'offline')) return
    saving.current = true
    const doc = s.doc
    store.set({ saveState: 'saving' })
    try {
      const { revision } = await saveCampusSite(tree.id, {
        baseRevision: s.revision,
        document: doc,
      })
      store.set({ revision, saveState: store.getState().doc === doc ? 'saved' : 'dirty' })
      if (store.getState().saveState === 'dirty')
        timer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
    } catch (e) {
      const err = toApiError(e)
      if (err.code === 'CONFLICT') store.set({ saveState: 'conflict' })
      else if (err.code === 'VALIDATION_ERROR') {
        store.set({ saveState: 'dirty' })
        toast.error(tErr(err.code))
      } else {
        store.set({ saveState: 'offline' })
        timer.current = setTimeout(() => void save(), RETRY_MS)
      }
    } finally {
      saving.current = false
    }
  }, [store, tree.id, tErr])

  useEffect(() => {
    let last = store.getState().doc
    const unsubscribe = store.subscribe(() => {
      const doc = store.getState().doc
      if (doc === last) return
      last = doc
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
    })
    const beforeUnload = (e: BeforeUnloadEvent): void => {
      if (['dirty', 'saving', 'offline'].includes(store.getState().saveState)) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      unsubscribe()
      window.removeEventListener('beforeunload', beforeUnload)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [store, save])

  const moveBuilding = useCallback(
    (id: string, transform: BuildingTransform) => {
      updateCampusBuilding(id, { transform })
        .then(() => qc.invalidateQueries({ queryKey: campusKeys.tree(tree.id) }))
        .catch((e) => toast.error(tErr(toApiError(e).code)))
    },
    [qc, tree.id, tErr],
  )

  // Клавиши инструментов, отмена, удаление. Esc помечаем — иначе useEscapeBack уведёт назад.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (el?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (key === 'escape') {
        e.preventDefault()
        const s = store.getState()
        if (s.draft.length > 0) store.set({ draft: [], cursor: null })
        else store.set({ selection: { kind: 'none' } })
        return
      }
      if (key === 'delete' || key === 'backspace') {
        const sel = store.getState().selection
        if (sel.kind === 'feature') {
          e.preventDefault()
          store.removeFeature(sel.id)
          store.set({ selection: { kind: 'none' } })
        }
        return
      }
      const tool = SITE_TOOLS.find((x) => x.key.toLowerCase() === key)
      if (tool) store.set({ tool: tool.id, draft: [], cursor: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  const doc = useSite(store, (s) => s.doc)
  const buildings = useSite(store, (s) => s.buildings)
  const sceneFloors = useMemo<SceneFloor[]>(
    () =>
      mode !== '3d'
        ? []
        : tree.buildings.flatMap((b) => {
            const placed = buildings.find((x) => x.id === b.id)
            return b.floors.map((f) => ({
              id: f.id,
              buildingId: b.id,
              level: f.level,
              doc: emptyFloorPlan(),
              elevationMm: f.elevationMm,
              heightMm: f.heightMm,
              transform: placed?.transform ?? b.transform,
              outline: b.outline,
            }))
          }),
    [mode, tree.buildings, buildings],
  )

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button asChild variant="ghost" size="md" icon aria-label={t('back')}>
          <Link href={backHref(me.data?.role as Role | undefined, tree.id)}>
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{tree.name}</p>
          <p className="text-xs text-muted-foreground">{t('title')}</p>
        </div>
        <SaveChip state={saveState} />
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('undo')}
            disabled={!canUndo}
            onClick={() => store.undo()}
          >
            <Undo2 aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('redo')}
            disabled={!canRedo}
            onClick={() => store.redo()}
          >
            <Redo2 aria-hidden />
          </Button>
          <SegmentedTabs
            aria-label={t('viewMode')}
            compact
            collapsible={false}
            value={mode}
            onChange={setMode}
            items={[
              { value: '2d', label: '2D' },
              { value: '3d', label: '3D' },
            ]}
          />
        </div>
      </header>
      {saveState === 'conflict' && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <CircleAlert className="size-4" aria-hidden />
          <span className="flex-1">{t('conflict')}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void fetchCampusSite(tree.id).then((fresh) =>
                store.replace(fresh.document, fresh.revision),
              )
            }
          >
            {t('loadLatest')}
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-0 flex-1">
          {mode === '2d' ? (
            <>
              <SiteCanvas store={store} onBuildingMoved={moveBuilding} />
              <div className="absolute top-3 left-3">
                <SiteToolbar store={store} />
              </div>
            </>
          ) : (
            <CampusScene3D
              label={t('preview3d')}
              floors={sceneFloors}
              mode="campus"
              focusFloorId={null}
              highlight={null}
              route={null}
              site={doc}
            />
          )}
        </div>
        <aside className="flex max-h-[40dvh] min-h-0 w-full flex-col gap-3 overflow-y-auto border-t border-border p-3 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l">
          <SiteProperties store={store} onBuildingChange={moveBuilding} />
        </aside>
      </div>
    </div>
  )
}

function SaveChip({ state }: { state: SiteSaveState }) {
  const t = useTranslations('CampusEditor')
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        state === 'conflict' || state === 'offline'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {state === 'saving' ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : state === 'offline' ? (
        <CloudOff className="size-3.5" aria-hidden />
      ) : (
        <Cloud className="size-3.5" aria-hidden />
      )}
      {t(`save_${state}`)}
    </span>
  )
}
