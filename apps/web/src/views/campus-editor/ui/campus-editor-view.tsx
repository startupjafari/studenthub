'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Role } from '@studenthub/shared-types'
import {
  ArrowLeft,
  CircleAlert,
  Cloud,
  CloudOff,
  LayoutTemplate,
  Loader2,
  Lock,
  Maximize,
  Redo2,
  Undo2,
} from 'lucide-react'
import {
  campusKeys,
  fetchCampusPlan,
  fetchCampusTree,
  type CampusPlan,
} from '../../../entities/campus'
import { fetchAllRooms, roomKeys } from '../../../entities/room'
import { fetchMe, userKeys } from '../../../entities/user'
import {
  EditorStore,
  PlanCanvas,
  ProblemsPanel,
  PropertiesPanel,
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
  const canvasBox = useRef<HTMLDivElement>(null)
  const viewport = () => ({
    width: canvasBox.current?.clientWidth ?? 800,
    height: canvasBox.current?.clientHeight ?? 600,
  })

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
        tools.cancel()
        store.set({ selection: { kind: 'none' } })
        return
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault()
        tools.deleteSelection()
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
  }, [store, tools, autosave])

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
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button asChild variant="ghost" size="md" icon aria-label={t('back')}>
          <Link href={backHref(me.data?.role as Role | undefined, plan.campusId)}>
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {building
              ? `${building.code ? `${building.code} · ` : ''}${building.name}`
              : (tree.data?.name ?? '')}
          </p>
          <p className="text-xs text-muted-foreground">{tc('floorN', { label: plan.label })}</p>
        </div>
        {building && building.floors.length > 1 && (
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
        )}
        <SaveChip state={saveState} />
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('undo')}
            title={`${t('undo')} (Ctrl+Z)`}
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
            title={`${t('redo')} (Ctrl+Shift+Z)`}
            disabled={!canRedo}
            onClick={() => store.redo()}
          >
            <Redo2 aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('fit')}
            title={`${t('fit')} (F)`}
            onClick={() => store.fit(viewport().width, viewport().height)}
          >
            <Maximize aria-hidden />
          </Button>
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
        <div ref={canvasBox} className="relative min-h-0 flex-1">
          {mode === '2d' ? (
            <>
              <PlanCanvas store={store} tools={tools} problemsShown={tab === 'problems'} />
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
            aria-label={t('panels')}
            stretch
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
              context={{ buildingName: building?.name ?? '', level: floor?.level ?? 0 }}
            />
          )}
          {tab === 'spaces' && <SpacesPanel store={store} viewport={viewport} />}
          {tab === 'problems' && <ProblemsPanel store={store} viewport={viewport} />}
        </aside>
      </div>

      {templateOpen && (
        <TemplateModal store={store} tools={tools} onClose={() => setTemplateOpen(false)} />
      )}
    </div>
  )
}

function SaveChip({ state }: { state: ReturnType<EditorStore['getState']>['saveState'] }) {
  const t = useTranslations('CampusEditor')
  const icon =
    state === 'saving' ? (
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
    ) : state === 'offline' ? (
      <CloudOff className="size-3.5" aria-hidden />
    ) : state === 'readonly' ? (
      <Lock className="size-3.5" aria-hidden />
    ) : state === 'conflict' ? (
      <CircleAlert className="size-3.5" aria-hidden />
    ) : (
      <Cloud className="size-3.5" aria-hidden />
    )
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
      {icon}
      {t(`save_${state}`)}
    </span>
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
