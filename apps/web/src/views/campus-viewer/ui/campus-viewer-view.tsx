'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Accessibility, Footprints, Map as MapIcon, Navigation, X } from 'lucide-react'
import {
  centerWalls,
  emptyFloorPlan,
  explainNoRoute,
  indexGraph,
  nodePoint,
  routeBetweenSpaces,
  routeSteps,
  SPACE_KINDS,
  type CenterWall,
  type FloorPlanDoc,
} from '@studenthub/campus-core'
import {
  campusKeys,
  fetchCampusNav,
  fetchCampusPublished,
  fetchCampusPublishedFloor,
  FloorSwitcher,
  type CampusManifestBuilding,
  type CampusSpaceHit,
} from '../../../entities/campus'
import { EditorStore, useEditor } from '../../../features/campus-editor'
import { CampusScene3D, type SceneFloor } from '../../../widgets/campus-3d'
import { CampusMapCanvas, type MapBuildingInput } from '../../../widgets/campus-map'
import { Button, Card, EmptyState, PageHeader, PageLoader, SegmentedTabs } from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import {
  routeInScene,
  routeOnFloor,
  routeEndsOnLevel,
  routeGeometry,
  routeOnLevel,
  routeStartFloor,
  routeTopFloor,
  type Place,
} from '../lib/places'
import { MapHints } from './map-hints'
import { RouteForm } from './route-form'
import { RouteStatus, RouteSummary } from './route-steps'
import { SpaceSearch } from './space-search'

type ViewMode = '2d' | '3d' | 'campus'

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
  const [routing, setRouting] = useState(false)
  // «Без лестниц»: маршрут только лифтами и пандусами (коляска, тележка, травма).
  const [stepFree, setStepFree] = useState(false)
  // Проход камерой по маршруту (3D): кнопка в сводке маршрута, прерывается мышью и клавишами.
  const [touring, setTouring] = useState(false)
  // Клик по помещению на карте в режиме маршрута — кандидат в «Откуда/Куда» (см. ниже).
  const mapPicked = useRef(false)
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
      // Выбор поиском или шагом маршрута — не клик по карте: поля маршрута им не заполняем.
      mapPicked.current = false
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
      else {
        mapPicked.current = true
        goTo(hit.floorId, hit.spaceId)
      }
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

  // Как в 2ГИС: в режиме маршрута клик по помещению на карте ставит его в первое пустое
  // поле — сначала «Откуда», потом «Куда». Оба заполнены — клик просто выбирает помещение.
  useEffect(() => {
    if (!mapPicked.current || !selectedPlace) return
    mapPicked.current = false
    if (!routing) return
    if (!from) setFrom(selectedPlace)
    else if (!to && selectedPlace.spaceId !== from.spaceId) setTo(selectedPlace)
    // selectedPlace — новый объект на каждый рендер; меняется он вместе с этими полями.
  }, [selectedSpace, floorId, routing])

  // Маршрут построен — показать его с начала: этаж, с которого идти.
  useEffect(() => {
    const graph = nav.data?.graph
    if (!graph || !route) return
    const start = routeStartFloor(graph, route)
    if (start) goTo(start, null)
    // Только на новый маршрут: смена этажа во время прохода сюда не относится.
  }, [route])
  // Планы этажей маршрута — для стен: по ним путь ложится на ось проходов (routeGeometry).
  const routeFloorIds = useMemo(() => {
    const graph = nav.data?.graph
    if (!graph || !route) return []
    return [...new Set(route.nodes.flatMap((n) => nodePoint(graph, n).floor ?? []))]
  }, [nav.data, route])
  const routeDocs = useQueries({
    queries: routeFloorIds.map((id) => ({
      queryKey: campusKeys.publishedFloor(campusId, id, versionId),
      queryFn: () => fetchCampusPublishedFloor(campusId, id),
      staleTime: Infinity,
    })),
  })
  const routeDocsKey = routeDocs.map((q) => (q.data ? 1 : 0)).join('')
  const routeWalls = useMemo(() => {
    const m = new Map<string, CenterWall[]>()
    for (const q of routeDocs) {
      const f = q.data && floorIndex.get(q.data.floorId)
      if (q.data && f) m.set(q.data.floorId, centerWalls(q.data.document, f.building.transform))
    }
    return m
    // routeDocsKey: пересобрать, когда догрузился план очередного этажа.
  }, [routeDocsKey, floorIndex])
  // Стены всех этажей пришли — тогда центруем; до того маршрут как в графе (без скачка
  // посередине: линия меняется один раз, а не по этажу).
  const routeReady = routeDocs.every((q) => q.data)
  const routePoints = useMemo(
    () => (index && route ? routeGeometry(index, route, routeReady ? routeWalls : new Map()) : []),
    [index, route, routeWalls, routeReady],
  )
  const mapRoute = useMemo(
    () =>
      routePoints.length > 1
        ? routeOnLevel(routePoints, new Set(levelFloors.map(({ f }) => f.id)))
        : [],
    [routePoints, levelFloors],
  )
  const markerFrom = t('markerFrom')
  const markerTo = t('markerTo')
  const mapRouteEnds = useMemo(
    () =>
      routePoints.length > 1
        ? {
            ...routeEndsOnLevel(routePoints, new Set(levelFloors.map(({ f }) => f.id))),
            labels: { a: markerFrom, b: markerTo },
          }
        : undefined,
    [routePoints, levelFloors, markerFrom, markerTo],
  )
  const sceneMarkers = useMemo(() => ({ from: markerFrom, to: markerTo }), [markerFrom, markerTo])
  // Подписи типов помещений — для табличек у дверей, когда у помещения нет номера и названия.
  const sceneKindLabels = useMemo(
    () => Object.fromEntries(SPACE_KINDS.map((k) => [k, tk(`kind_${k}`)])),
    [tk],
  )
  // Все этажи корпусов — для кнопок в кабине лифта при проходе по маршруту.
  const sceneFloorIndex = useMemo(
    () =>
      buildings.flatMap((b) =>
        b.floors.map((f) => ({
          id: f.id,
          buildingId: b.id,
          label: f.label,
          elevationMm: f.elevationMm,
        })),
      ),
    [buildings],
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
    () => (routePoints.length > 1 ? routeInScene(routePoints) : null),
    [routePoints],
  )
  const highlight = useMemo(
    () => (selectedSpace && floorId ? { floorId, spaceId: selectedSpace } : null),
    [selectedSpace, floorId],
  )
  const onPick3d = useCallback(
    (fid: string, spaceId: string) => {
      mapPicked.current = true
      goTo(fid, spaceId)
    },
    [goTo],
  )
  const onTourEnd = useCallback(() => setTouring(false), [])
  const toggleTour = (): void => {
    if (touring) {
      setTouring(false)
      return
    }
    // Проход — камерой в 3D: с плана переключаемся сами. Уровень — самый высокий этаж
    // маршрута: все его этажи видны, и за проход уровень не меняется — ничего не мигает.
    if (mode === '2d') setMode('3d')
    const graph = nav.data?.graph
    const top = graph && route ? routeTopFloor(graph, route, floorIndex) : null
    if (top) goTo(top, null)
    setTouring(true)
  }
  useEffect(() => {
    if (mode === '2d') setTouring(false)
  }, [mode])

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
              routeEnds={mapRouteEnds}
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
                site={data.manifest.site ?? null}
                onPick={onPick3d}
                tour={touring}
                routeMarkers={sceneMarkers}
                floorIndex={sceneFloorIndex}
                kindLabels={sceneKindLabels}
                onTourEnd={onTourEnd}
              />
            </div>
          )}
          {/* Уровни всего кампуса: и план, и 3D показывают все корпуса разом. */}
          <FloorSwitcher
            label={t('floors')}
            items={[...levels].reverse().map(([lv, lb]) => ({
              key: String(lv),
              label: lb,
              ariaLabel: t('floorN', { label: lb }),
              active: lv === level,
              onSelect: () => goToLevel(lv),
            }))}
          />
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
              <div className="flex items-center gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Navigation className="size-4 text-primary" aria-hidden />
                  {t('route')}
                </h2>
                <Button
                  type="button"
                  size="sm"
                  variant={stepFree ? 'default' : 'outline'}
                  aria-pressed={stepFree}
                  title={t('stepFreeHint')}
                  onClick={() => setStepFree((v) => !v)}
                  className="ml-auto"
                >
                  <Accessibility aria-hidden />
                  {t('stepFree')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={t('closeRoute')}
                  onClick={() => {
                    setRouting(false)
                    setTouring(false)
                    setFrom(null)
                    setTo(null)
                  }}
                >
                  <X aria-hidden />
                </Button>
              </div>
              <RouteForm
                campusId={campusId}
                from={from}
                to={to}
                onPick={(end, v) => {
                  const place = 'buildingId' in v ? v : placeOf(v)
                  if (end === 'from') setFrom(place)
                  else setTo(place)
                }}
                onClear={(end) => (end === 'from' ? setFrom(null) : setTo(null))}
                onSwap={() => {
                  setFrom(to)
                  setTo(from)
                }}
                suggestions={[
                  ...(selectedPlace ? [{ place: selectedPlace, kind: 'selected' as const }] : []),
                  ...gates.map((place) => ({ place, kind: 'gate' as const })),
                ]}
              />
              <RouteStatus
                from={from}
                to={to}
                loading={nav.isFetching}
                hasRoute={!!route}
                reason={reason}
                stepFree={stepFree}
                onAllowStairs={() => setStepFree(false)}
              />
              {route && (
                <RouteSummary
                  steps={steps}
                  currentFloor={floorId}
                  floorLabel={(fid) => {
                    const f = fid ? floorIndex.get(fid) : undefined
                    return f ? t('floorN', { label: f.floor.label }) : ''
                  }}
                  placeLabel={(spaceId) =>
                    spaceId === from?.spaceId ? from.label : spaceId === to?.spaceId ? to.label : ''
                  }
                  buildingOf={(fid) =>
                    fid
                      ? (floorIndex.get(fid)?.building.code ??
                        floorIndex.get(fid)?.building.name ??
                        '')
                      : ''
                  }
                  onStep={(fid, spaceId) => {
                    const end = [from, to].find((p) => p && p.spaceId === spaceId)
                    if (end?.floorId) focusOn(end.floorId, end.spaceId)
                    else if (fid) goTo(fid, null)
                  }}
                  touring={touring}
                  onTour={toggleTour}
                />
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
