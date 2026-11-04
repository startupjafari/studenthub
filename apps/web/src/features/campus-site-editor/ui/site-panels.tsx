'use client'

import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import {
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
      aria-orientation="vertical"
      aria-label={t('tools')}
      className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm"
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
            'flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground md:size-9',
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
