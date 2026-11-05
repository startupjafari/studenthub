'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Accessibility,
  DoorOpen,
  ArrowDownUp,
  CircleAlert,
  Footprints,
  Map as MapIcon,
  Navigation,
  X,
} from 'lucide-react'
import {
  emptyFloorPlan,
  explainNoRoute,
  indexGraph,
  routeBetweenSpaces,
  routeSteps,
  type FloorPlanDoc,
  type RouteStep,
} from '@studenthub/campus-core'
import {
  campusKeys,
  fetchCampusNav,
  fetchCampusPublished,
  fetchCampusPublishedFloor,
  type CampusManifestBuilding,
  type CampusSpaceHit,
} from '../../../entities/campus'
import { EditorStore, useEditor } from '../../../features/campus-editor'
import { CampusScene3D, type SceneFloor } from '../../../widgets/campus-3d'
import { CampusMapCanvas, type MapBuildingInput } from '../../../widgets/campus-map'
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Label,
  PageHeader,
  PageLoader,
  SegmentedTabs,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import { routeInScene, routeOnFloor, routeOnLevel, type Place } from '../lib/places'
import { MapHints } from './map-hints'
import { SpaceSearch } from './space-search'

type ViewMode = '2d' | '3d' | 'campus'

/** Скорость пешехода для оценки времени (§15.5) — допущение пишем рядом с цифрой. */
const WALK_MM_PER_MIN = 72_000
/** До стольких этажей режим «Кампус» грузит планы и рисует фасады; больше — коробки. */
const CAMPUS_DETAIL_FLOORS = 40

/**
 * Карта кампуса для членов вуза (docs/CAMPUS_BUILDER.md §16.1): поиск помещения, этажи,
 * план сверху и 3D по кнопке, маршрут между помещениями с учётом лестниц, лифтов и улицы.
 * Этаж и помещение — в адресе (`floor`, `space`): ссылку на помещение можно переслать.
 */
export function CampusViewerView({ campusId }: { campusId: string }) {
  const t = useTranslations('CampusMap')
  const published = useQuery({
    queryKey: campusKeys.published(campusId),
    queryFn: () => fetchCampusPublished(campusId),
  })
  if (published.isPending) return <PageLoader label={t('loading')} />
  if (!published.data) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState
          icon={<MapIcon className="size-6" aria-hidden />}
          title={t('notPublished')}
          description={t('notPublishedText')}
        />
      </div>
    )
  }
  return <Viewer campusId={campusId} data={published.data} />
}

function Viewer({
  campusId,
  data,
}: {
  campusId: string
  data: NonNullable<Awaited<ReturnType<typeof fetchCampusPublished>>>
}) {
  const t = useTranslations('CampusMap')
  const tk = useTranslations('CampusEditor')
  const router = useRouter()
  const params = useSearchParams()
  const buildings = data.manifest.buildings
  const versionId = data.version.id
  const staff = data.level !== 'public'

  const floorIndex = useMemo(() => {
    const m = new Map<
      string,
      { building: CampusManifestBuilding; floor: CampusManifestBuilding['floors'][number] }
    >()
    for (const b of buildings) for (const f of b.floors) m.set(f.id, { building: b, floor: f })
    return m
  }, [buildings])
  const defaultFloor = useMemo(() => {
    const b = buildings[0]
    const f = b?.floors.find((x) => x.level === 1) ?? b?.floors[0]
    return f?.id ?? null
  }, [buildings])

  const [floorId, setFloorId] = useState<string | null>(() => {
    const q = params.get('floor')
    return q && floorIndex.has(q) ? q : defaultFloor
  })
  const [mode, setMode] = useState<ViewMode>('2d')
  const [from, setFrom] = useState<Place | null>(null)
  const [to, setTo] = useState<Place | null>(null)
  const [stepFree, setStepFree] = useState(false)
  const [routing, setRouting] = useState(false)
  const pendingSpace = useRef<string | null>(params.get('space'))
  const canvasBox = useRef<HTMLDivElement>(null)
  // Подвести карту к помещению: ссылка, поиск, шаг маршрута. Клик по карте — не подводит.
  const [focusReq, setFocusReq] = useState<{
    floorId: string
    spaceId: string
    nonce: number
  } | null>(() => {
    const space = params.get('space')
    return space && floorId ? { floorId, spaceId: space, nonce: 1 } : null
  })

  const current = floorId ? floorIndex.get(floorId) : undefined
  const [store] = useState(() => {
    const s = new EditorStore(emptyFloorPlan(), 0, 3300)
    s.set({ saveState: 'readonly' })
    return s
  })

  const floorDoc = useQuery({
    queryKey: campusKeys.publishedFloor(campusId, floorId ?? '', versionId),
    queryFn: () => fetchCampusPublishedFloor(campusId, floorId!),
    enabled: !!floorId,
    staleTime: Infinity,
  })

  // Новый этаж — в холст: документ, вписать, выделить помещение из ссылки или поиска.
  useEffect(() => {
    const doc = floorDoc.data?.document
    if (!doc) return
    store.replace(doc, 0)
    store.set({ saveState: 'readonly', floorHeightMm: current?.floor.heightMm ?? 3300 })
    const box = canvasBox.current
    const want = pendingSpace.current
    pendingSpace.current = null
    if (want && doc.spaces[want]) {
      const sp = doc.spaces[want]!
      store.set({ selection: { kind: 'space', id: want } })
      if (box) {
        const k = 0.06
        store.set({
          view: {
            scale: k,
            ox: box.clientWidth / 2 - sp.label.x * k,
            oy: box.clientHeight / 2 + sp.label.y * k,
          },
        })
      }
    } else if (box) {
      store.fit(box.clientWidth, box.clientHeight)
    }
  }, [floorDoc.data, store, current?.floor.heightMm])

  // Выделенное помещение — в адрес, чтобы ссылкой можно было поделиться.
  const selection = useEditor(store, (s) => s.selection)
  const doc = useEditor(store, (s) => s.doc)
  const selectedSpace = selection.kind === 'space' ? selection.id : null
  useEffect(() => {
    if (!floorId) return
    const q = new URLSearchParams()
    q.set('floor', floorId)
    if (selectedSpace) q.set('space', selectedSpace)
    router.replace(`/campus/${campusId}?${q.toString()}`, { scroll: false })
  }, [floorId, selectedSpace, campusId, router])

  const goTo = useCallback(
    (fid: string, spaceId: string | null) => {
      if (fid === floorId) {
        if (spaceId) {
          const sp = store.getState().doc.spaces[spaceId]
          store.set({ selection: { kind: 'space', id: spaceId } })
          const box = canvasBox.current
          if (sp && box) {
            const k = Math.max(store.getState().view.scale, 0.05)
            store.set({
              view: {
                scale: k,
                ox: box.clientWidth / 2 - sp.label.x * k,
                oy: box.clientHeight / 2 + sp.label.y * k,
              },
            })
          }
        }
        return
      }
      pendingSpace.current = spaceId
      setFloorId(fid)
    },
    [floorId, store],
  )

  /** Перейти к помещению с подводом карты: поиск, шаг маршрута. */
  const focusOn = useCallback(
    (fid: string, spaceId: string | null) => {
      goTo(fid, spaceId)
      if (spaceId) setFocusReq({ floorId: fid, spaceId, nonce: Date.now() })
    },
    [goTo],
  )

  // ── Карта уровня: все корпуса на этаже текущего уровня ────────────────────────────
  const level = current?.floor.level ?? 1
  const levels = useMemo(() => {
    const byLevel = new Map<number, string>()
    for (const b of buildings)
      for (const f of b.floors) if (!byLevel.has(f.level)) byLevel.set(f.level, f.label)
    return [...byLevel.entries()].sort((a, b) => b[0] - a[0])
  }, [buildings])
  const levelFloors = useMemo(
    () =>
      buildings.flatMap((b) => {
        const f = b.floors.find((x) => x.level === level)
        return f ? [{ b, f }] : []
      }),
    [buildings, level],
  )
  const levelDocs = useQueries({
    queries: levelFloors.map(({ f }) => ({
      queryKey: campusKeys.publishedFloor(campusId, f.id, versionId),
      queryFn: () => fetchCampusPublishedFloor(campusId, f.id),
      staleTime: Infinity,
    })),
  })
  const levelDocsKey = levelDocs.map((q) => (q.data ? 1 : 0)).join('')
  const mapBuildings = useMemo<MapBuildingInput[]>(() => {
    const docs = new Map(
      levelDocs.flatMap((q) => (q.data ? [[q.data.floorId, q.data.document] as const] : [])),
    )
    return buildings.map((b) => {
      const f = b.floors.find((x) => x.level === level)
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        outline: b.outline,
        transform: b.transform,
        floorId: f?.id ?? null,
        doc: f ? (docs.get(f.id) ?? null) : null,
      }
    })
    // levelDocsKey: пересобрать, когда догрузился план очередного корпуса.
  }, [buildings, level, levelDocsKey])
  const goToLevel = (lv: number): void => {
    const f =
      current?.building.floors.find((x) => x.level === lv) ??
      buildings.flatMap((b) => b.floors).find((x) => x.level === lv)
    if (f) goTo(f.id, null)
  }
  const onMapPick = useCallback(
    (hit: { floorId: string; spaceId: string } | null) => {
      if (!hit) store.set({ selection: { kind: 'none' } })
      else goTo(hit.floorId, hit.spaceId)
    },
    [goTo, store],
  )

  // Ворота территории — готовые точки «откуда» для посетителей (граф знает их как `gate:<id>`).
  const gates = useMemo<Place[]>(
    () =>
      Object.entries(data.manifest.site?.features ?? {}).flatMap(([id, f]) =>
        f.type === 'gate'
          ? [{ spaceId: `gate:${id}`, floorId: '', buildingId: '', label: f.name ?? t('gate') }]
          : [],
      ),
    [data.manifest.site, t],
  )

  const placeOf = (hit: CampusSpaceHit): Place | null =>
    hit.floor && hit.building
      ? {
          spaceId: hit.spaceId,
          floorId: hit.floor.id,
          buildingId: hit.building.id,
          label: hit.number ?? hit.name ?? '',
        }
      : null
  const selectedPlace: Place | null =
    selectedSpace && floorId && current
      ? {
          spaceId: selectedSpace,
          floorId,
          buildingId: current.building.id,
          label:
            doc.spaces[selectedSpace]?.number ??
            doc.spaces[selectedSpace]?.name ??
            tk(`kind_${doc.spaces[selectedSpace]?.kind ?? 'other'}`),
        }
      : null

  // ── Маршрут ────────────────────────────────────────────────────────────────────────
  const nav = useQuery({
    queryKey: campusKeys.nav(campusId, versionId),
    queryFn: () => fetchCampusNav(campusId),
    enabled: routing,
    staleTime: Infinity,
  })
  const index = useMemo(() => (nav.data?.graph ? indexGraph(nav.data.graph) : null), [nav.data])
  const route = useMemo(
    () =>
      index && from && to
        ? routeBetweenSpaces(index, from.spaceId, to.spaceId, { stepFree, staff })
        : null,
    [index, from, to, stepFree, staff],
  )
  const reason = useMemo(
    () =>
      nav.data && from && to && !route
        ? explainNoRoute(index, from.spaceId, to.spaceId, { stepFree, staff })
        : null,
    [nav.data, index, from, to, route, stepFree, staff],
  )
  const steps = useMemo(() => (index && route ? routeSteps(index, route) : []), [index, route])
  const mapRoute = useMemo(
    () =>
      nav.data?.graph && route
        ? routeOnLevel(nav.data.graph, route, new Set(levelFloors.map(({ f }) => f.id)))
        : [],
    [nav.data, route, levelFloors],
  )

  useEffect(() => {
    const graph = nav.data?.graph
    store.set({
      route:
        graph && route && floorId && current
          ? routeOnFloor(graph, route, floorId, current.building.transform)
          : [],
    })
  }, [nav.data, route, floorId, current, store])

  // ── 3D ────────────────────────────────────────────────────────────────────────────
  // 3D — все корпуса до текущего уровня включительно, как план: уровень общий для кампуса.
  // Небольшой кампус в режиме «Кампус» — все этажи с планами: фасады с окнами вместо коробок.
  const allFloors = buildings.flatMap((b) => b.floors)
  const campusDetailed = mode === 'campus' && allFloors.length <= CAMPUS_DETAIL_FLOORS
  const buildingFloors =
    mode === '3d' ? allFloors.filter((f) => f.level <= level) : campusDetailed ? allFloors : []
  const floorDocs = useQueries({
    queries: buildingFloors.map((f) => ({
      queryKey: campusKeys.publishedFloor(campusId, f.id, versionId),
      queryFn: () => fetchCampusPublishedFloor(campusId, f.id),
      staleTime: Infinity,
    })),
  })
  const docsKey = floorDocs.map((q) => (q.data ? 1 : 0)).join('')
  const sceneFloors = useMemo<SceneFloor[]>(() => {
    const docs = new Map(
      floorDocs.flatMap((q) => (q.data ? [[q.data.floorId, q.data.document] as const] : [])),
    )
    if (mode === 'campus') {
      return buildings.flatMap((b) =>
        b.floors.map((f) => ({
          id: f.id,
          buildingId: b.id,
          level: f.level,
          // Пока не догрузились все этажи корпуса, он остаётся коробкой (см. scene.ts).
          doc: docs.get(f.id) ?? (f.id === floorId ? doc : emptyFloorPlan()),
          elevationMm: f.elevationMm,
          heightMm: f.heightMm,
          transform: b.transform,
          outline: b.outline,
        })),
      )
    }
    if (mode !== '3d') return []
    return buildings.flatMap((b) =>
      b.floors.flatMap((f) => {
        const d: FloorPlanDoc | undefined = f.level <= level ? docs.get(f.id) : undefined
        return d
          ? [
              {
                id: f.id,
                buildingId: b.id,
                level: f.level,
                doc: d,
                elevationMm: f.elevationMm,
                heightMm: f.heightMm,
                transform: b.transform,
                outline: b.outline,
              },
            ]
          : []
      }),
    )
    // docsKey: пересобрать, когда догрузился очередной этаж.
  }, [mode, buildings, level, docsKey, floorId, doc])
  const sceneRoute = useMemo(
    () => (nav.data?.graph && route ? routeInScene(nav.data.graph, route) : null),
    [nav.data, route],
  )
  const highlight = useMemo(
    () => (selectedSpace && floorId ? { floorId, spaceId: selectedSpace } : null),
    [selectedSpace, floorId],
  )
  const onPick3d = useCallback((fid: string, spaceId: string) => goTo(fid, spaceId), [goTo])

  /** Клавиши карты, общие для плана и 3D: PgUp/PgDn — этаж, Esc — снять выбор. */
  const onMapKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      // `levels` — сверху вниз: выше — к началу списка.
      const i = levels.findIndex(([lv]) => lv === level)
      const next = levels[e.key === 'PageUp' ? i - 1 : i + 1]
      e.preventDefault()
      if (next) goToLevel(next[0])
    } else if (e.key === 'Escape' && selectedSpace) {
      e.preventDefault()
      store.set({ selection: { kind: 'none' } })
    }
  }

  if (!current || !floorId) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader title={data.campus.name} subtitle={t('subtitle')} />
        <EmptyState icon={<MapIcon className="size-6" aria-hidden />} title={t('noFloors')} />
      </div>
    )
  }

  // Пришли по прямой ссылке — истории нет: «назад» ведёт на главную. Список кампусов не годится:
  // при одном кампусе он сразу открывает карту обратно.
  const goBack = (): void => {
    if (window.history.length > 1) router.back()
    else router.push('/')
  }

  const floorLabel = (fid: string | null) => {
    const f = fid ? floorIndex.get(fid) : undefined
    return f
      ? `${f.building.code ?? f.building.name} · ${t('floorN', { label: f.floor.label })}`
      : ''
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={data.campus.name}
        subtitle={t('subtitle')}
        onBack={goBack}
        backLabel={t('back')}
        tabs={
          <SegmentedTabs
            aria-label={t('viewMode')}
            collapsible={false}
            value={mode}
            onChange={setMode}
            items={[
              { value: '2d', label: t('mode2d') },
              { value: '3d', label: '3D' },
              { value: 'campus', label: t('modeCampus') },
            ]}
          />
        }
        actions={
          <div className="w-full sm:w-72">
            <SpaceSearch
              campusId={campusId}
              placeholder={t('searchPlaceholder')}
              onPick={(hit) => hit.floor && focusOn(hit.floor.id, hit.spaceId)}
            />
          </div>
        }
      />

      {/* Холст читалке не виден: что выбрано и на каком этаже — вслух (§22.33). */}
      <p className="sr-only" aria-live="polite">
        {selectedPlace
          ? t('selectedAnnounce', { place: selectedPlace.label, floor: floorLabel(floorId) })
          : floorLabel(floorId)}
      </p>
      {/* Карта и панель — одной высоты: на десктопе карточка панели тянется до низа карты,
          длинное содержимое прокручивается в панели; на телефоне карта сверху, панель под ней. */}
      <div className="flex flex-col gap-4 lg:h-[calc(100dvh-6.25rem)] lg:min-h-[32rem] lg:flex-row">
        <div
          onKeyDown={onMapKey}
          className="relative h-[60dvh] min-h-[18rem] overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:h-auto lg:flex-1"
        >
          <div ref={canvasBox} className={cn('absolute inset-0', mode !== '2d' && 'invisible')}>
            <CampusMapCanvas
              buildings={mapBuildings}
              site={data.manifest.site ?? null}
              selected={selectedSpace ? { floorId, spaceId: selectedSpace } : null}
              route={mapRoute}
              focus={focusReq}
              onPick={onMapPick}
              label={t('planLabel', { floor: floorLabel(floorId) })}
            />
          </div>
          {mode !== '2d' && (
            <div className="absolute inset-0">
              <CampusScene3D
                label={t('scene3dLabel')}
                floors={sceneFloors}
                mode={mode === 'campus' ? 'campus' : 'building'}
                focusFloorId={floorId}
                highlight={highlight}
                route={sceneRoute}
                site={mode === 'campus' ? (data.manifest.site ?? null) : null}
                onPick={onPick3d}
              />
            </div>
          )}
          {/* Этажи — справа, как кнопки лифта: сверху вниз. */}
          <nav
            aria-label={t('floors')}
            className="absolute top-3 right-3 flex flex-col gap-1 rounded-xl bg-card/95 p-1 shadow-sm ring-1 ring-foreground/10 backdrop-blur"
          >
            {/* Уровни всего кампуса: и план, и 3D показывают все корпуса разом. */}
            {levels.map(([lv, lb]) => (
              <button
                key={lv}
                type="button"
                aria-current={lv === level}
                aria-label={t('floorN', { label: lb })}
                onClick={() => goToLevel(lv)}
                className={cn(
                  'flex size-11 items-center justify-center rounded-xl text-sm font-semibold tabular-nums md:size-9',
                  'hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
                  lv === level && 'bg-primary text-primary-foreground hover:bg-primary',
                )}
              >
                {lb}
              </button>
            ))}
          </nav>
          <MapHints mode={mode} />
        </div>

        <aside className="flex min-h-0 w-full flex-col gap-4 lg:w-80 lg:overflow-y-auto">
          {selectedPlace && !routing && (
            <SpaceCard
              place={selectedPlace}
              kind={doc.spaces[selectedPlace.spaceId]?.kind ?? 'other'}
              name={doc.spaces[selectedPlace.spaceId]?.name ?? null}
              number={doc.spaces[selectedPlace.spaceId]?.number ?? null}
              capacity={doc.spaces[selectedPlace.spaceId]?.capacity ?? null}
              floorLabel={floorLabel(floorId)}
              onClose={() => store.set({ selection: { kind: 'none' } })}
              onRouteTo={() => {
                setTo(selectedPlace)
                setRouting(true)
              }}
              onRouteFrom={() => {
                setFrom(selectedPlace)
                setRouting(true)
              }}
            />
          )}
          {routing ? (
            <Card className="gap-3 p-4 lg:flex-1" role="region" aria-label={t('route')}>
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Navigation className="size-4 text-primary" aria-hidden />
                  {t('route')}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('closeRoute')}
                  onClick={() => {
                    setRouting(false)
                    setFrom(null)
                    setTo(null)
                  }}
                >
                  <X aria-hidden />
                </Button>
              </div>
              <PlacePicker
                campusId={campusId}
                label={t('from')}
                value={from}
                onPick={(h) => setFrom(placeOf(h))}
                onClear={() => setFrom(null)}
              />
              {!from && gates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {gates.map((g) => (
                    <Button
                      key={g.spaceId}
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setFrom(g)}
                    >
                      <DoorOpen aria-hidden />
                      {g.label}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('swap')}
                  onClick={() => {
                    setFrom(to)
                    setTo(from)
                  }}
                >
                  <ArrowDownUp aria-hidden />
                </Button>
              </div>
              <PlacePicker
                campusId={campusId}
                label={t('to')}
                value={to}
                onPick={(h) => setTo(placeOf(h))}
                onClear={() => setTo(null)}
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="step-free"
                  checked={stepFree}
                  onCheckedChange={(v) => setStepFree(v === true)}
                />
                <Label htmlFor="step-free" className="flex items-center gap-1.5 text-sm">
                  <Accessibility className="size-4" aria-hidden />
                  {t('stepFree')}
                </Label>
              </div>
              {nav.isFetching && (
                <p className="text-sm text-muted-foreground">{t('routeLoading')}</p>
              )}
              {route && (
                <RouteSteps
                  steps={steps}
                  floorLabel={(fid) => {
                    const f = fid ? floorIndex.get(fid) : undefined
                    return f ? t('floorN', { label: f.floor.label }) : ''
                  }}
                  placeLabel={(spaceId) =>
                    spaceId === from?.spaceId ? from.label : spaceId === to?.spaceId ? to.label : ''
                  }
                  onStep={(fid) => fid && goTo(fid, null)}
                  buildingOf={(fid) =>
                    fid
                      ? (floorIndex.get(fid)?.building.code ??
                        floorIndex.get(fid)?.building.name ??
                        '')
                      : ''
                  }
                />
              )}
              {reason && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-destructive/5 p-3 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {t(`noRoute_${reason}`)}
                </p>
              )}
            </Card>
          ) : (
            !selectedPlace && (
              <Card className="gap-3 p-4 lg:flex-1">
                <p className="text-sm text-muted-foreground">{t('hint')}</p>
                <Button type="button" variant="outline" size="md" onClick={() => setRouting(true)}>
                  <Footprints aria-hidden />
                  {t('buildRoute')}
                </Button>
              </Card>
            )
          )}
        </aside>
      </div>
    </div>
  )
}

function SpaceCard({
  place,
  kind,
  name,
  number,
  capacity,
  floorLabel,
  onClose,
  onRouteTo,
  onRouteFrom,
}: {
  place: Place
  kind: string
  name: string | null
  number: string | null
  capacity: number | null
  floorLabel: string
  onClose: () => void
  onRouteTo: () => void
  onRouteFrom: () => void
}) {
  const t = useTranslations('CampusMap')
  const tk = useTranslations('CampusEditor')
  return (
    <Card className="gap-3 p-4 lg:flex-1" role="region" aria-label={place.label}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tabular-nums">
            {number ?? name ?? tk(`kind_${kind}`)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[number && name ? name : null, tk(`kind_${kind}`)].filter(Boolean).join(' · ')}
          </p>
          <p className="text-xs text-muted-foreground">
            {floorLabel}
            {capacity ? ` · ${t('capacity', { count: capacity })}` : ''}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label={t('close')}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="md" className="flex-1" onClick={onRouteTo}>
          <Navigation aria-hidden />
          {t('routeHere')}
        </Button>
        <Button type="button" size="md" variant="outline" onClick={onRouteFrom}>
          {t('routeFromHere')}
        </Button>
      </div>
    </Card>
  )
}

function PlacePicker({
  campusId,
  label,
  value,
  onPick,
  onClear,
}: {
  campusId: string
  label: string
  value: Place | null
  onPick: (hit: CampusSpaceHit) => void
  onClear: () => void
}) {
  const t = useTranslations('CampusMap')
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value ? (
        <div className="flex h-9 items-center justify-between gap-2 rounded-xl border border-border px-3 text-sm">
          <span className="truncate font-medium">{value.label}</span>
          <button
            type="button"
            onClick={onClear}
            aria-label={t('clear')}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <SpaceSearch campusId={campusId} placeholder={t('pickPlace')} onPick={onPick} />
      )}
    </div>
  )
}

function RouteSteps({
  steps,
  floorLabel,
  placeLabel,
  onStep,
  buildingOf,
}: {
  steps: RouteStep[]
  floorLabel: (floorId: string | null) => string
  placeLabel: (spaceId: string | null) => string
  onStep: (floorId: string | null) => void
  buildingOf: (floorId: string | null) => string
}) {
  const t = useTranslations('CampusMap')
  const text = (s: RouteStep): string => {
    switch (s.type) {
      case 'start':
        return s.spaceId?.startsWith('gate:')
          ? t('stepStartGate', { place: placeLabel(s.spaceId) })
          : t('stepStart', { place: placeLabel(s.spaceId) })
      case 'vertical':
        return t(`stepVertical_${s.via}`, {
          up: s.up ? 'up' : 'down',
          floor: floorLabel(s.toFloor),
        })
      case 'exit':
        return t('stepExit', { building: buildingOf(s.fromFloor) })
      case 'enter':
        return t('stepEnter', { building: buildingOf(s.toFloor), floor: floorLabel(s.toFloor) })
      case 'arrive':
        return t('stepArrive', {
          place: placeLabel(s.spaceId),
          meters: Math.round(s.distanceMm / 1000),
          minutes: Math.max(1, Math.round(s.distanceMm / WALK_MM_PER_MIN)),
        })
    }
  }
  const floorOf = (s: RouteStep): string | null =>
    s.type === 'vertical'
      ? s.toFloor
      : s.type === 'enter'
        ? s.toFloor
        : s.type === 'exit'
          ? s.fromFloor
          : null
  return (
    <ol className="flex flex-col gap-1">
      {steps.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            disabled={!floorOf(s)}
            onClick={() => onStep(floorOf(s))}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm enabled:hover:bg-muted"
          >
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
              {i + 1}
            </span>
            <span>{text(s)}</span>
          </button>
        </li>
      ))}
      <li className="px-2 text-xs text-muted-foreground">{t('timeAssumption')}</li>
    </ol>
  )
}
