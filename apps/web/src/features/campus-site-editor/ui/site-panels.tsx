'use client'

import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import {
  Building2,
  Car,
  Dumbbell,
  Hand,
  MousePointer2,
  Route,
  Spline,
  Sprout,
  SquareDashed,
  Trash2,
  TreeDeciduous,
  Type,
  Warehouse,
  Armchair,
} from 'lucide-react'
import type { BuildingTransform, SiteFeature } from '@studenthub/campus-core'
import { Button, Checkbox, Label } from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import { ChoiceField, NumberField, TextField } from '../../../entities/campus'
import { polygonArea } from '../lib/site-geometry'
import { useSite, type SiteStore, type SiteTool } from '../model/site-store'

export const SITE_TOOLS: {
  id: SiteTool
  icon: ComponentType<{ className?: string }>
  key: string
}[] = [
  { id: 'select', icon: MousePointer2, key: 'V' },
  { id: 'boundary', icon: SquareDashed, key: 'B' },
  { id: 'path', icon: Spline, key: 'P' },
  { id: 'road', icon: Route, key: 'R' },
  { id: 'lawn', icon: Sprout, key: 'L' },
  { id: 'parking', icon: Car, key: 'K' },
  { id: 'sport', icon: Dumbbell, key: 'S' },
  { id: 'rest', icon: Armchair, key: 'O' },
  { id: 'tree', icon: TreeDeciduous, key: 'T' },
  { id: 'gate', icon: Warehouse, key: 'G' },
  { id: 'label', icon: Type, key: 'X' },
  { id: 'pan', icon: Hand, key: 'H' },
]

export function SiteToolbar({ store }: { store: SiteStore }) {
  const t = useTranslations('CampusSite')
  const active = useSite(store, (s) => s.tool)
  return (
    <div
      role="toolbar"
      aria-label={t('tools')}
      // На телефоне — строкой с прокруткой (столбец из 10+ кнопок не влезает в холст), с md —
      // столбцом слева, как в редакторах на десктопе. Поверхность — как у карточек системы.
      className="flex max-w-[calc(100vw-1.5rem)] flex-row gap-1 overflow-x-auto rounded-xl bg-card p-1 shadow-sm ring-1 ring-foreground/10 md:max-w-none md:flex-col md:overflow-visible"
    >
      {SITE_TOOLS.map(({ id, icon: Icon, key }) => (
        <button
          key={id}
          type="button"
          aria-pressed={active === id}
          aria-label={t(`tool_${id}`)}
          title={`${t(`tool_${id}`)} (${key})`}
          onClick={() => store.set({ tool: id, draft: [], cursor: null })}
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground md:size-9',
            'focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
            active === id &&
              'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
          )}
        >
          <Icon className="size-5 md:size-4" />
        </button>
      ))}
    </div>
  )
}

/** Свойства выделенного объекта территории или корпуса. */
export function SiteProperties({
  store,
  onBuildingChange,
}: {
  store: SiteStore
  onBuildingChange: (id: string, transform: BuildingTransform) => void
}) {
  const t = useTranslations('CampusSite')
  const sel = useSite(store, (s) => s.selection)
  const doc = useSite(store, (s) => s.doc)
  const buildings = useSite(store, (s) => s.buildings)

  if (sel.kind === 'building') {
    const b = buildings.find((x) => x.id === sel.id)
    if (!b) return null
    const set = (patch: Partial<BuildingTransform>): void => {
      const transform = { ...b.transform, ...patch }
      store.setBuilding(b.id, transform)
      onBuildingChange(b.id, transform)
    }
    return (
      <Section title={`${b.code ? `${b.code} · ` : ''}${b.name}`} hint={t('buildingHint')}>
        <NumberField
          label="X"
          suffix={t('m')}
          value={b.transform.x / 1000}
          step={0.5}
          onCommit={(v) => set({ x: Math.round(v * 1000) })}
        />
        <NumberField
          label="Y"
          suffix={t('m')}
          value={b.transform.y / 1000}
          step={0.5}
          onCommit={(v) => set({ y: Math.round(v * 1000) })}
        />
        <NumberField
          label={t('rotation')}
          suffix="°"
          value={b.transform.rotationDeg}
          min={-180}
          max={180}
          onCommit={(v) => set({ rotationDeg: v })}
        />
      </Section>
    )
  }

  if (sel.kind === 'boundary') {
    return (
      <Section
        title={t('boundary')}
        hint={t('areaHa', { ha: (polygonArea(doc.boundary) / 1e10).toFixed(2) })}
      >
        <Button
          type="button"
          variant="destructive"
          size="md"
          onClick={() => {
            store.apply((d) => ({ ...d, boundary: [] }))
            store.set({ selection: { kind: 'none' } })
          }}
        >
          <Trash2 aria-hidden />
          {t('delete')}
        </Button>
      </Section>
    )
  }

  if (sel.kind === 'feature') {
    const f = doc.features[sel.id]
    if (!f) return null
    const set = (next: SiteFeature): void => store.setFeature(sel.id, next)
    const del = (
      <Button
        type="button"
        variant="destructive"
        size="md"
        className="mt-2"
        onClick={() => {
          store.removeFeature(sel.id)
          store.set({ selection: { kind: 'none' } })
        }}
      >
        <Trash2 aria-hidden />
        {t('delete')}
      </Button>
    )
    const name =
      'name' in f ? (
        <TextField
          label={t('name')}
          value={f.name ?? ''}
          maxLength={100}
          onCommit={(v) => set({ ...f, name: v || undefined } as SiteFeature)}
        />
      ) : null
    return (
      <Section
        title={t(`tool_${f.type}`)}
        hint={
          'polygon' in f ? t('areaM2', { m2: Math.round(polygonArea(f.polygon) / 1e6) }) : undefined
        }
      >
        {name}
        {(f.type === 'path' || f.type === 'road') && (
          <NumberField
            label={t('width')}
            suffix={t('m')}
            value={f.widthMm / 1000}
            step={0.5}
            min={f.type === 'road' ? 2 : 0.5}
            max={f.type === 'road' ? 40 : 20}
            onCommit={(v) => set({ ...f, widthMm: Math.round(v * 1000) })}
          />
        )}
        {f.type === 'path' && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="site-covered"
              checked={f.covered}
              onCheckedChange={(v) => set({ ...f, covered: v === true })}
            />
            <Label htmlFor="site-covered" className="text-sm">
              {t('covered')}
            </Label>
          </div>
        )}
        {f.type === 'gate' && (
          <NumberField
            label={t('width')}
            suffix={t('m')}
            value={f.widthMm / 1000}
            step={0.5}
            min={0.8}
            max={20}
            onCommit={(v) => set({ ...f, widthMm: Math.round(v * 1000) })}
          />
        )}
        {f.type === 'tree' && (
          <ChoiceField
            label={t('treeVariant')}
            value={f.variant}
            options={(['deciduous', 'conifer'] as const).map((v) => ({
              value: v,
              label: t(`tree_${v}`),
            }))}
            onChange={(variant) => set({ ...f, variant })}
          />
        )}
        {f.type === 'label' && (
          <TextField
            label={t('text')}
            value={f.text}
            maxLength={200}
            onCommit={(text) => text && set({ ...f, text })}
          />
        )}
        {del}
      </Section>
    )
  }

  return (
    <Section title={t('hintTitle')}>
      <p className="text-sm leading-relaxed text-muted-foreground">{t('hint')}</p>
    </Section>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground tabular-nums">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

/**
 * Объекты территории списком — пара к вкладке «Помещения» редактора этажа: найти и выделить
 * то, что на плане мелко или перекрыто. Корпуса сверху, затем объекты по типам.
 */
export function SiteObjectsList({ store }: { store: SiteStore }) {
  const t = useTranslations('CampusSite')
  const doc = useSite(store, (s) => s.doc)
  const buildings = useSite(store, (s) => s.buildings)
  const sel = useSite(store, (s) => s.selection)
  const icon = (id: SiteTool): ComponentType<{ className?: string }> =>
    SITE_TOOLS.find((x) => x.id === id)?.icon ?? MousePointer2
  const features = Object.entries(doc.features).sort(
    ([, a], [, b]) =>
      SITE_TOOLS.findIndex((x) => x.id === a.type) - SITE_TOOLS.findIndex((x) => x.id === b.type),
  )
  const rows: {
    key: string
    label: string
    meta: string
    Icon: ComponentType<{ className?: string }>
    active: boolean
    select: () => void
  }[] = [
    ...buildings.map((b) => ({
      key: b.id,
      label: `${b.code ? `${b.code} · ` : ''}${b.name}`,
      meta: t('building'),
      Icon: Building2,
      active: sel.kind === 'building' && sel.id === b.id,
      select: () => store.set({ selection: { kind: 'building', id: b.id }, tool: 'select' }),
    })),
    ...features.map(([id, f]) => ({
      key: id,
      label: ('name' in f && f.name) || (f.type === 'label' ? f.text : t(`tool_${f.type}`)),
      meta: t(`tool_${f.type}`),
      Icon: icon(f.type),
      active: sel.kind === 'feature' && sel.id === id,
      select: () => store.set({ selection: { kind: 'feature', id }, tool: 'select' }),
    })),
  ]
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('noObjects')}</p>
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map(({ key, label, meta, Icon, active, select }) => (
        <li key={key}>
          <button
            type="button"
            onClick={select}
            aria-current={active}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted',
              'focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
              active && 'bg-primary/10',
            )}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {label !== meta && (
              <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
