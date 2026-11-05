'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Role } from '@studenthub/shared-types'
import Link from 'next/link'
import { CircleAlert, Layers, Pencil } from 'lucide-react'
import {
  checkOutline,
  emptyFloorPlan,
  floorFromOutline,
  isBareOutlineFloor,
  normalizeOutline,
  type BuildingTransform,
  type Pt,
} from '@studenthub/campus-core'
import {
  CampusEditorHeader,
  UnderlayPanel,
  UnderlayStore,
  campusKeys,
  fetchCampusPlan,
  fetchCampusSite,
  fetchCampusTree,
  saveCampusPlan,
  saveCampusSite,
  updateCampusBuilding,
  type AutoLayoutFloorsResult,
  type CampusBuildingRow,
  type CampusSite,
  type CampusTree,
} from '../../../entities/campus'
import { fetchMe, userKeys } from '../../../entities/user'
import {
  SITE_TOOLS,
  SiteCanvas,
  SiteObjectsList,
  SiteProperties,
  SiteStore,
  SiteToolbar,
  useSite,
  type ViewInsets,
} from '../../../features/campus-site-editor'
import { CampusScene3D, type SceneFloor } from '../../../widgets/campus-3d'
import { Button, EmptyState, PageLoader, SegmentedTabs } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { NewBuildingDialog } from './new-building-dialog'

const SAVE_DELAY_MS = 1500
const RETRY_MS = 5000

function backHref(role: Role | undefined, campusId: string): string {
  if (role === Role.UNIVERSITY_MODERATOR) return `/moderator/university/campus/${campusId}`
  if (role === Role.UNIVERSITY_ADMIN) return `/university-admin/campus/${campusId}`
  return '/'
}

/**
 * Редактор территории (docs/CAMPUS_BUILDER.md §14): граница, дорожки, дороги, газоны,
 * парковки, площадки, деревья, ворота, надписи и корпуса. Корпус любой формы обводят прямо
 * здесь — он сразу создаётся с этажами; углы потом правят мышью. Под чертёж можно положить
 * снимок со спутника (подложка живёт только в этом браузере). Документ территории
 * сохраняется сам с ревизией, корпус — своими запросами.
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
  // Живое дерево: после нового корпуса и правки контура этажи и контуры перечитываются.
  const live = useQuery({
    queryKey: campusKeys.tree(tree.id),
    queryFn: () => fetchCampusTree(tree.id),
    initialData: tree,
  }).data
  const [underlay] = useState(() => new UnderlayStore(`site:${tree.id}`))
  const [drawn, setDrawn] = useState<Pt[] | null>(null)
  const canvasBox = useRef<HTMLDivElement>(null)
  const toolbarBox = useRef<HTMLDivElement>(null)
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
  const [tab, setTab] = useState<'props' | 'objects'>('props')
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

  useEffect(() => {
    void underlay.load()
    return () => underlay.dispose()
  }, [underlay])

  /**
   * Что закрывает панель инструментов: с md она столбцом слева, на телефоне — строкой сверху.
   * Объект из списка встаёт в оставшуюся часть холста.
   */
  const canvasInsets = useCallback((): ViewInsets => {
    const box = canvasBox.current?.getBoundingClientRect()
    const bar = toolbarBox.current?.getBoundingClientRect()
    const none = { left: 0, top: 0, right: 0, bottom: 0 }
    if (!box || !bar || bar.width === 0) return none
    return bar.height > bar.width
      ? { ...none, left: bar.right - box.left }
      : { ...none, top: bar.bottom - box.top }
  }, [])

  /** Видимая часть плана в мм — туда вписывается новая подложка. */
  const visibleRect = useCallback(() => {
    const w = canvasBox.current?.clientWidth ?? 800
    const h = canvasBox.current?.clientHeight ?? 600
    const a = store.toPlan(0, h)
    const b = store.toPlan(w, 0)
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
  }, [store])

  const onBuildingDrawn = useCallback(
    (outline: Pt[]) => {
      if (checkOutline(outline)) {
        toast.error(t('outlineInvalid'))
        return
      }
      setDrawn(outline)
    },
    [t],
  )

  const onBuildingCreated = (
    b: CampusBuildingRow,
    floors: number,
    layout: AutoLayoutFloorsResult | null,
  ): void => {
    setDrawn(null)
    store.addBuilding({
      id: b.id,
      name: b.name,
      code: b.code,
      outline: b.outline,
      transform: b.transform,
    })
    store.set({ tool: 'select', selection: { kind: 'building', id: b.id } })
    setTab('props')
    void qc.invalidateQueries({ queryKey: campusKeys.tree(tree.id) })
    toast.success(t('buildingDrawn', { name: b.name, count: floors }))
    // Не прямые углы — автопланировка не сработала: этажи остались с наружными стенами.
    if (layout?.error) toast.info(t('autoLayoutSkipped'))
  }

  /**
   * Новый контур корпуса. Этажи, где только наружные стены по старому контуру, пересобираются
   * по новому; нарисованные не трогаем — стены этажа работа автора, о них только предупреждаем.
   */
  const onBuildingOutline = useCallback(
    (id: string, outline: Pt[]) => {
      if (checkOutline(outline)) {
        toast.error(t('outlineInvalid'))
        return
      }
      const before = store.getState().buildings.find((b) => b.id === id)?.outline
      if (!before) return
      const next = normalizeOutline(outline)
      store.setBuildingOutline(id, next)
      void (async () => {
        try {
          await updateCampusBuilding(id, { outline: next })
          const fresh = await qc.fetchQuery({
            queryKey: campusKeys.tree(tree.id),
            queryFn: () => fetchCampusTree(tree.id),
            staleTime: 0,
          })
          const floors = fresh.buildings.find((b) => b.id === id)?.floors ?? []
          let rebuilt = 0
          let kept = 0
          for (const f of floors) {
            const plan = await fetchCampusPlan(f.id)
            if (!isBareOutlineFloor(plan.document, before)) {
              kept++
              continue
            }
            await saveCampusPlan(f.id, {
              baseRevision: plan.revision,
              document: floorFromOutline(next),
            })
            void qc.invalidateQueries({ queryKey: campusKeys.plan(f.id) })
            rebuilt++
          }
          void qc.invalidateQueries({ queryKey: campusKeys.tree(tree.id) })
          if (kept > 0) toast.warning(t('outlineKept', { rebuilt, kept }))
          else toast.success(t('outlineRebuilt', { count: rebuilt }))
        } catch (e) {
          store.setBuildingOutline(id, before)
          toast.error(tErr(toApiError(e).code))
        }
      })()
    },
    [qc, store, t, tErr, tree.id],
  )

  /** Этажи выделенного корпуса — сразу из территории в редактор этажа. */
  const buildingFloors = (id: string) => {
    const floors = live.buildings.find((b) => b.id === id)?.floors ?? []
    if (floors.length === 0) return null
    return (
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted-foreground">{t('floors')}</h3>
        <ul className="flex flex-col">
          {[...floors].reverse().map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
            >
              <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                {t('floorN', { label: f.label })}
              </span>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/campus-editor/${f.id}`}>
                  <Pencil aria-hidden />
                  {t('editFloor')}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

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
        if (s.draft.length > 0 || s.rect)
          store.set({ draft: [], cursor: null, typed: '', rect: null })
        else if (underlay.getState().mode !== 'idle') underlay.setMode('idle')
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
      if (tool) store.set({ tool: tool.id, draft: [], cursor: null, typed: '', rect: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, underlay])

  const doc = useSite(store, (s) => s.doc)
  const buildings = useSite(store, (s) => s.buildings)
  const sceneFloors = useMemo<SceneFloor[]>(
    () =>
      mode !== '3d'
        ? []
        : live.buildings.flatMap((b) => {
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
    [mode, live.buildings, buildings],
  )

  return (
    <div className="flex h-dvh flex-col bg-background">
      <CampusEditorHeader
        backHref={backHref(me.data?.role as Role | undefined, tree.id)}
        title={tree.name}
        subtitle={t('title')}
        saveState={saveState}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        onFit={() => store.requestFit()}
        mode={mode}
        onModeChange={setMode}
      />
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
        <div ref={canvasBox} className="relative min-h-0 flex-1 overflow-hidden">
          {mode === '2d' ? (
            <>
              <SiteCanvas
                store={store}
                underlay={underlay}
                onBuildingMoved={moveBuilding}
                onBuildingDrawn={onBuildingDrawn}
                onBuildingOutline={onBuildingOutline}
                insets={canvasInsets}
              />
              {/* С md — по центру высоты холста; на телефоне — строкой сверху. */}
              <div
                ref={toolbarBox}
                className="absolute top-3 left-3 md:top-1/2 md:flex md:max-h-[calc(100%-1.5rem)] md:-translate-y-1/2 md:flex-col"
              >
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
        <aside className="flex max-h-[45dvh] min-h-0 w-full flex-col gap-3 overflow-y-auto border-t border-border p-3 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l">
          <SegmentedTabs
            className="shrink-0"
            aria-label={t('panels')}
            stretch
            compact
            collapsible={false}
            value={tab}
            onChange={setTab}
            items={[
              { value: 'props', label: t('properties') },
              { value: 'objects', label: t('objects') },
            ]}
          />
          {tab === 'props' ? (
            <SiteProperties
              store={store}
              onBuildingChange={moveBuilding}
              buildingExtras={buildingFloors}
              idleExtras={<UnderlayPanel store={underlay} visibleRect={visibleRect} />}
            />
          ) : (
            <SiteObjectsList store={store} />
          )}
        </aside>
      </div>
      {drawn && (
        <NewBuildingDialog
          campusId={tree.id}
          outline={drawn}
          takenCodes={buildings.map((b) => b.code)}
          onCreated={onBuildingCreated}
          onClose={() => setDrawn(null)}
        />
      )}
    </div>
  )
}
