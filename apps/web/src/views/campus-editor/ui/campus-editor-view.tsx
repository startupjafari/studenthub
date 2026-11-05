'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Role } from '@studenthub/shared-types'
import { CircleAlert, Cloud, LayoutTemplate, Lock } from 'lucide-react'
import {
  CampusEditorHeader,
  UnderlayPanel,
  UnderlayStore,
  campusKeys,
  fetchCampusPlan,
  fetchCampusTree,
  type CampusPlan,
} from '../../../entities/campus'
import { fetchAllRooms, roomKeys } from '../../../entities/room'
import { fetchMe, userKeys } from '../../../entities/user'
import {
  EditorStore,
  LinkRoomsButton,
  PlanCanvas,
  ProblemsPanel,
  PropertiesPanel,
  RouteCheckPanel,
  SpacesPanel,
  TemplateModal,
  ToolController,
  Toolbar,
  TOOLS,
  dropDraft,
  loadDraft,
  useAutosave,
  useEditor,
  useValidation,
  type FloorDraft,
} from '../../../features/campus-editor'
import {
  Button,
  EmptyState,
  PageLoader,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import { CampusPreview3D } from './campus-preview-3d'

type PanelTab = 'props' | 'spaces' | 'problems'

/** Куда возвращаться из редактора — экран кампуса своей роли. */
function backHref(role: Role | undefined, campusId: string): string {
  if (role === Role.UNIVERSITY_MODERATOR) return `/moderator/university/campus/${campusId}`
  if (role === Role.UNIVERSITY_ADMIN) return `/university-admin/campus/${campusId}`
  return '/'
}

/**
 * Редактор этажа (docs/CAMPUS_BUILDER.md §12): отдельная страница без оболочки приложения —
 * холсту нужен весь экран. Слева инструменты, справа свойства, помещения и проверка.
 */
export function CampusEditorView({ floorId }: { floorId: string }) {
  const t = useTranslations('CampusEditor')
  const plan = useQuery({
    queryKey: campusKeys.plan(floorId),
    queryFn: () => fetchCampusPlan(floorId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  if (plan.isPending) return <PageLoader label={t('loading')} />
  if (!plan.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState
          icon={<CircleAlert className="size-6" aria-hidden />}
          title={t('floorNotFound')}
        />
      </div>
    )
  }
  // Ключ по этажу: при переходе на другой этаж редактор собирается заново, история — своя.
  return <Editor key={floorId} plan={plan.data} />
}

function Editor({ plan }: { plan: CampusPlan }) {
  const t = useTranslations('CampusEditor')
  const tc = useTranslations('Campus')
  const router = useRouter()
  const [store] = useState(() => new EditorStore(plan.document, plan.revision, plan.heightMm))
  const [tools] = useState(() => new ToolController(store))
  const [tab, setTab] = useState<PanelTab>('props')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [draft, setDraft] = useState<FloorDraft | null>(null)
  const [underlay] = useState(() => new UnderlayStore(`floor:${plan.floorId}`))
  const canvasBox = useRef<HTMLDivElement>(null)
  const viewport = () => ({
    width: canvasBox.current?.clientWidth ?? 800,
    height: canvasBox.current?.clientHeight ?? 600,
  })
  /** Видимая часть плана в мм — туда вписывается новая подложка. */
  const visibleRect = () => {
    const { width, height } = viewport()
    const a = store.toPlan(0, height)
    const b = store.toPlan(width, 0)
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
  }

  useEffect(() => {
    void underlay.load()
    return () => underlay.dispose()
  }, [underlay])

  useValidation(store)
  const autosave = useAutosave(store, plan.floorId)

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const tree = useQuery({
    queryKey: campusKeys.tree(plan.campusId),
    queryFn: () => fetchCampusTree(plan.campusId),
  })
  const roomsQuery = useQuery({
    queryKey: roomKeys.everything(),
    queryFn: fetchAllRooms,
    staleTime: 60_000,
  })
  const rooms = useMemo(
    () => new Map((roomsQuery.data ?? []).map((r) => [r.id, r])),
    [roomsQuery.data],
  )
  const building = tree.data?.buildings.find((b) => b.id === plan.buildingId)
  const floor = building?.floors.find((f) => f.id === plan.floorId)
  const floorContext = {
    buildingName: building?.name ?? '',
    buildingCode: building?.code ?? null,
    level: floor?.level ?? 0,
  }
  const roomRequired = useEditor(store, (s) => s.problems.some((p) => p.code === 'ROOM_REQUIRED'))

  const saveState = useEditor(store, (s) => s.saveState)
  const canUndo = useEditor(store, (s) => s.canUndo)
  const canRedo = useEditor(store, (s) => s.canRedo)
  const errors = useEditor(store, (s) => s.problems.filter((p) => p.severity === 'error').length)
  const problems = useEditor(store, (s) => s.problems.length)

  // Локальный черновик новее сервера — предложить восстановить.
  useEffect(() => {
    void loadDraft(plan.floorId).then((d) => {
      if (d && JSON.stringify(d.doc) !== JSON.stringify(plan.document)) setDraft(d)
      else if (d) void dropDraft(plan.floorId)
    })
  }, [plan.floorId, plan.document])

  // Горячие клавиши (§12.4). В полях ввода не перехватываются.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (el?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        store.redo()
        return
      }
      if (mod && key === 's') {
        e.preventDefault()
        autosave.flush()
        return
      }
      if (mod || e.altKey) return
      if (key === 'escape') {
        // Esc в редакторе — отмена жеста и выделения, а не «назад» (useEscapeBack).
        e.preventDefault()
        underlay.setMode('idle')
        tools.cancel()
        store.set({ selection: { kind: 'none' } })
        return
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault()
        tools.deleteSelection()
        return
      }
      const arrows: Record<string, [number, number]> = {
        arrowleft: [-1, 0],
        arrowright: [1, 0],
        arrowup: [0, 1],
        arrowdown: [0, -1],
      }
      if (arrows[key]) {
        // Стрелки двигают выделенное: 10 мм, с Shift — 100 мм.
        e.preventDefault()
        const step = e.shiftKey ? 100 : 10
        tools.nudge(arrows[key]![0] * step, arrows[key]![1] * step)
        return
      }
      if (key === 'f') {
        const { width, height } = viewport()
        store.fit(width, height)
        return
      }
      const tool = TOOLS.find((x) => x.key.toLowerCase() === key)
      if (tool) {
        tools.cancel()
        store.set({ tool: tool.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, tools, autosave, underlay])

  const restoreDraft = (): void => {
    if (!draft) return
    store.replace(draft.doc, draft.baseRevision)
    store.set({ saveState: 'dirty' })
    setDraft(null)
    autosave.flush()
  }

  const reloadServer = async (): Promise<void> => {
    const fresh = await fetchCampusPlan(plan.floorId)
    store.replace(fresh.document, fresh.revision)
    void dropDraft(plan.floorId)
  }

  const overwrite = (): void => {
    if (autosave.conflictRevision === null) return
    store.set({ revision: autosave.conflictRevision, saveState: 'dirty' })
    autosave.flush()
  }

  const goFloor = (id: string): void => {
    autosave.flush()
    router.push(`/campus-editor/${id}`)
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <CampusEditorHeader
        backHref={backHref(me.data?.role as Role | undefined, plan.campusId)}
        title={
          building
            ? `${building.code ? `${building.code} · ` : ''}${building.name}`
            : (tree.data?.name ?? '')
        }
        subtitle={tc('floorN', { label: plan.label })}
        saveState={saveState}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        onFit={() => store.fit(viewport().width, viewport().height)}
        mode={mode}
        onModeChange={setMode}
        leading={
          building && building.floors.length > 1 ? (
            <Select value={plan.floorId} onValueChange={goFloor}>
              <SelectTrigger size="md" className="w-auto min-w-32" aria-label={t('floor')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...building.floors].reverse().map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {tc('floorN', { label: f.label })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
        trailing={
          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={saveState === 'readonly'}
            onClick={() => setTemplateOpen(true)}
          >
            <LayoutTemplate aria-hidden />
            <span className="hidden sm:inline">{t('templates')}</span>
          </Button>
        }
      />

      {saveState === 'readonly' && autosave.holder && (
        <Banner
          tone="info"
          icon={<Lock className="size-4" aria-hidden />}
          text={t('readonlyHolder')}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void autosave.takeOver()}
          >
            {t('takeOver')}
          </Button>
        </Banner>
      )}
      {saveState === 'conflict' && (
        <Banner
          tone="destructive"
          icon={<CircleAlert className="size-4" aria-hidden />}
          text={t('conflict')}
        >
          <Button type="button" size="sm" variant="outline" onClick={() => void reloadServer()}>
            {t('loadLatest')}
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={overwrite}>
            {t('overwrite')}
          </Button>
        </Banner>
      )}
      {draft && saveState !== 'readonly' && (
        <Banner
          tone="info"
          icon={<Cloud className="size-4" aria-hidden />}
          text={draft.baseRevision === plan.revision ? t('draftFound') : t('draftFoundStale')}
        >
          <Button type="button" size="sm" onClick={restoreDraft}>
            {t('restoreDraft')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void dropDraft(plan.floorId)
              setDraft(null)
            }}
          >
            {t('discardDraft')}
          </Button>
        </Banner>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={canvasBox} className="relative min-h-0 flex-1 overflow-hidden">
          {mode === '2d' ? (
            <>
              <PlanCanvas
                store={store}
                tools={tools}
                underlay={underlay}
                problemsShown={tab === 'problems'}
              />
              <div className="absolute top-3 left-3">
                <Toolbar store={store} tools={tools} />
              </div>
            </>
          ) : (
            <CampusPreview3D store={store} floorHeightMm={plan.heightMm} />
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
              { value: 'spaces', label: t('spaces') },
              {
                value: 'problems',
                label:
                  errors > 0
                    ? `${t('check')} · ${errors}`
                    : problems > 0
                      ? `${t('check')} · ${problems}`
                      : t('check'),
              },
            ]}
          />
          {tab === 'props' && (
            <PropertiesPanel
              store={store}
              tools={tools}
              rooms={rooms}
              context={floorContext}
              idleExtras={<UnderlayPanel store={underlay} visibleRect={visibleRect} />}
            />
          )}
          {tab === 'spaces' && (
            <>
              <LinkRoomsButton store={store} rooms={roomsQuery.data} context={floorContext} />
              <SpacesPanel store={store} viewport={viewport} />
            </>
          )}
          {tab === 'problems' && (
            <>
              {roomRequired && (
                <LinkRoomsButton store={store} rooms={roomsQuery.data} context={floorContext} />
              )}
              <ProblemsPanel store={store} viewport={viewport} />
              <RouteCheckPanel store={store} />
            </>
          )}
        </aside>
      </div>

      {templateOpen && (
        <TemplateModal
          store={store}
          tools={tools}
          outline={building?.outline ?? null}
          level={floor?.level ?? 1}
          onClose={() => setTemplateOpen(false)}
        />
      )}
    </div>
  )
}

function Banner({
  tone,
  icon,
  text,
  children,
}: {
  tone: 'info' | 'destructive'
  icon: React.ReactNode
  text: string
  children: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm',
        tone === 'destructive'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-info/30 bg-info/5',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{text}</span>
      <span className="flex gap-2">{children}</span>
    </div>
  )
}
