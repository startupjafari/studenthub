'use client'

import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Columns3, Link2, Plus, Trash2 } from 'lucide-react'
import {
  ACADEMIC_SPACE_KINDS,
  DOOR_ACCESS,
  DOOR_SWINGS,
  SPACE_KINDS,
  SPACE_VISIBILITY,
  VERTICAL_TYPES,
  WALL_KINDS,
  splitSpaceIntoRooms,
  wallLength,
  type FloorPlanDoc,
  type PlanOpening,
  type PlanSpace,
} from '@studenthub/campus-core'
import { createRoomRequest, roomKeys, RoomSelect, type Room } from '../../../entities/room'
import { Button, Checkbox, Label } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { useEditor, type EditorStore } from '../model/store'
import type { ToolController } from '../model/tools'
import { ChoiceField, Field, NumberField, TextField } from '../../../entities/campus'
import { ROOM_KIND_BY_SPACE } from '../model/link-rooms'

interface Props {
  store: EditorStore
  tools: ToolController
  rooms: Map<string, Room>
  context: { buildingName: string; level: number }
  /** Без выделения, под настройками инструментов — подложка. */
  idleExtras?: React.ReactNode
}

/**
 * Свойства выделенного (§12.8). Без выделения — настройки инструментов: толщина новых стен,
 * ширина дверей, тип новой комнаты.
 */
export function PropertiesPanel({ store, tools, rooms, context, idleExtras }: Props) {
  const t = useTranslations('CampusEditor')
  const sel = useEditor(store, (s) => s.selection)
  const doc = useEditor(store, (s) => s.doc)
  const readonly = useEditor(store, (s) => s.saveState === 'readonly')

  const update = (label: string, fn: (doc: FloorPlanDoc) => FloorPlanDoc, key?: string) =>
    store.apply(label, fn, key ?? null)
  const del = (
    <Button
      type="button"
      variant="destructive"
      size="md"
      className="mt-2 w-full"
      disabled={readonly}
      onClick={() => tools.deleteSelection()}
    >
      <Trash2 aria-hidden />
      {t('delete')}
    </Button>
  )

  if (sel.kind === 'wall') {
    const w = doc.walls[sel.id]
    if (!w) return null
    const set = (patch: Partial<typeof w>) =>
      update('wall', (d) => ({
        ...d,
        walls: { ...d.walls, [sel.id]: { ...d.walls[sel.id]!, ...patch } },
      }))
    return (
      <Section
        title={t('wall')}
        hint={t('lengthM', { m: (wallLength(doc, sel.id) / 1000).toFixed(2) })}
      >
        <ChoiceField
          label={t('wallKind')}
          value={w.kind}
          disabled={readonly}
          options={WALL_KINDS.map((k) => ({ value: k, label: t(`wallKind_${k}`) }))}
          onChange={(kind) => set({ kind })}
        />
        <NumberField
          label={t('thickness')}
          suffix={t('mm')}
          value={w.thicknessMm}
          min={20}
          max={2000}
          step={10}
          disabled={readonly}
          onCommit={(v) => set({ thicknessMm: v })}
        />
        <NumberField
          label={t('heightOptional')}
          suffix={t('mm')}
          value={w.heightMm ?? 0}
          min={0}
          max={20_000}
          step={10}
          disabled={readonly}
          onCommit={(v) => set({ heightMm: v >= 100 ? v : undefined })}
        />
        {del}
      </Section>
    )
  }

  if (sel.kind === 'node') {
    const n = doc.nodes[sel.id]
    if (!n) return null
    const move = (patch: Partial<typeof n>) => tools.moveNodeTo(sel.id, { ...n, ...patch })
    return (
      <Section title={t('node')}>
        <NumberField
          label="X"
          suffix={t('mm')}
          value={n.x}
          disabled={readonly}
          onCommit={(x) => move({ x })}
        />
        <NumberField
          label="Y"
          suffix={t('mm')}
          value={n.y}
          disabled={readonly}
          onCommit={(y) => move({ y })}
        />
        {del}
      </Section>
    )
  }

  if (sel.kind === 'opening') {
    const o = doc.openings[sel.id]
    if (!o) return null
    const set = (patch: Partial<PlanOpening>) =>
      update('opening', (d) => ({
        ...d,
        openings: { ...d.openings, [sel.id]: { ...d.openings[sel.id]!, ...patch } as PlanOpening },
      }))
    return (
      <Section title={o.type === 'door' ? t('door') : t('window')}>
        <NumberField
          label={t('width')}
          suffix={t('mm')}
          value={o.widthMm}
          min={300}
          max={20_000}
          step={10}
          disabled={readonly}
          onCommit={(v) => set({ widthMm: v })}
        />
        <NumberField
          label={t('height')}
          suffix={t('mm')}
          value={o.heightMm}
          min={300}
          max={10_000}
          step={10}
          disabled={readonly}
          onCommit={(v) => set({ heightMm: v })}
        />
        <NumberField
          label={t('offset')}
          suffix={t('mm')}
          value={o.offsetMm}
          min={0}
          step={10}
          disabled={readonly}
          onCommit={(v) => set({ offsetMm: v })}
        />
        {o.type === 'door' ? (
          <>
            <ChoiceField
              label={t('swing')}
              value={o.swing}
              disabled={readonly}
              options={DOOR_SWINGS.map((k) => ({ value: k, label: t(`swing_${k}`) }))}
              onChange={(swing) => set({ swing })}
            />
            <ChoiceField
              label={t('access')}
              value={o.access}
              disabled={readonly}
              options={DOOR_ACCESS.map((k) => ({ value: k, label: t(`access_${k}`) }))}
              onChange={(access) => set({ access })}
            />
          </>
        ) : (
          <NumberField
            label={t('sill')}
            suffix={t('mm')}
            value={o.sillMm}
            min={0}
            max={10_000}
            step={10}
            disabled={readonly}
            onCommit={(v) => set({ sillMm: v })}
          />
        )}
        {del}
      </Section>
    )
  }

  if (sel.kind === 'space') {
    const sp = doc.spaces[sel.id]
    if (!sp) return null
    return (
      <SpaceProps
        key={sel.id}
        id={sel.id}
        space={sp}
        store={store}
        rooms={rooms}
        context={context}
        readonly={readonly}
        footer={del}
        wallThicknessMm={tools.settings.wallThicknessMm}
      />
    )
  }

  if (sel.kind === 'face') {
    return (
      <Section title={t('freeArea')} hint={t('freeAreaHint')}>
        <ChoiceField
          label={t('spaceKind')}
          value={tools.settings.spaceKind}
          disabled={readonly}
          options={SPACE_KINDS.map((k) => ({ value: k, label: t(`kind_${k}`) }))}
          onChange={(k) => {
            tools.settings = { ...tools.settings, spaceKind: k }
            store.set({})
          }}
        />
        <Button
          type="button"
          size="md"
          disabled={readonly}
          onClick={() => tools.createSpace(sel.id)}
        >
          <Plus aria-hidden />
          {t('createSpace')}
        </Button>
      </Section>
    )
  }

  if (sel.kind === 'vertical') {
    const v = doc.verticals[sel.id]
    if (!v) return null
    const set = (patch: Partial<typeof v>) =>
      update('vertical', (d) => ({
        ...d,
        verticals: { ...d.verticals, [sel.id]: { ...d.verticals[sel.id]!, ...patch } },
      }))
    return (
      <Section title={t(`vertical_${v.type}`)}>
        <ChoiceField
          label={t('verticalType')}
          value={v.type}
          disabled={readonly}
          options={VERTICAL_TYPES.map((k) => ({ value: k, label: t(`vertical_${k}`) }))}
          onChange={(type) => set({ type })}
        />
        <TextField
          label={t('groupId')}
          value={v.groupId}
          maxLength={40}
          disabled={readonly}
          onCommit={(groupId) => groupId && set({ groupId })}
        />
        <p className="text-xs text-muted-foreground">{t('groupIdHint')}</p>
        <CheckRow
          label={t('stepFree')}
          checked={v.stepFree}
          disabled={readonly}
          onChange={(stepFree) => set({ stepFree })}
        />
        {del}
      </Section>
    )
  }

  if (sel.kind === 'label') {
    const l = doc.labels[sel.id]
    if (!l) return null
    return (
      <Section title={t('label')}>
        <TextField
          label={t('labelText')}
          value={l.text === '…' ? '' : l.text}
          maxLength={200}
          disabled={readonly}
          onCommit={(text) =>
            text &&
            update('label', (d) => ({
              ...d,
              labels: { ...d.labels, [sel.id]: { ...d.labels[sel.id]!, text } },
            }))
          }
        />
        {del}
      </Section>
    )
  }

  return (
    <>
      <ToolSettingsPanel store={store} tools={tools} readonly={readonly} />
      {idleExtras}
    </>
  )
}

function SpaceProps({
  id,
  space,
  store,
  rooms,
  context,
  readonly,
  footer,
  wallThicknessMm,
}: {
  id: string
  space: PlanSpace
  store: EditorStore
  rooms: Map<string, Room>
  context: Props['context']
  readonly: boolean
  footer: React.ReactNode
  /** Толщина перегородок «Разбить на комнаты» — та же, что у новых стен. */
  wallThicknessMm: number
}) {
  const t = useTranslations('CampusEditor')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const roomFieldId = useId()
  const area = useEditor(store, (s) => {
    const faceId = Object.entries(s.faceSpace).find(([, sp]) => sp === id)?.[0]
    return s.faces.find((f) => f.id === faceId)?.areaMm2 ?? null
  })
  const set = (patch: Partial<PlanSpace>) =>
    store.apply('space', (d) => {
      const cur = d.spaces[id]
      if (!cur) return d
      const next: PlanSpace = { ...cur, ...patch }
      // Пустые строки и отвязка — без ключа: схема не принимает пустой номер.
      for (const k of ['number', 'name', 'roomId', 'capacity'] as const) {
        if (next[k] === '' || next[k] === undefined || next[k] === null) delete next[k]
      }
      return { ...d, spaces: { ...d.spaces, [id]: next } }
    })
  const academic = ACADEMIC_SPACE_KINDS.includes(space.kind)
  const linked = space.roomId ? rooms.get(space.roomId) : undefined
  const [parts, setParts] = useState(4)

  // «Разбить на комнаты»: равные части поперёк длинной стороны, номера по порядку, двери в
  // коридор. Одним шагом истории — Ctrl+Z вернёт помещение целым.
  const split = (): void => {
    const result = splitSpaceIntoRooms(
      store.getState().doc,
      id,
      { count: parts },
      { thicknessMm: wallThicknessMm, kind: 'wall' },
      store.ids,
    )
    if (!result) {
      toast.error(t('splitTooNarrow'))
      return
    }
    store.apply('splitRooms', () => result)
    toast.success(t('splitDone', { count: parts }))
  }

  const createRoom = useMutation({
    mutationFn: () =>
      createRoomRequest({
        name: (space.number || space.name || '').slice(0, 100),
        kind: ROOM_KIND_BY_SPACE[space.kind] ?? 'OTHER',
        capacity: space.capacity,
        building: context.buildingName.slice(0, 100),
        floor: Math.min(100, Math.max(-5, context.level)),
      }),
    onSuccess: (room) => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      set({ roomId: room.id })
      toast.success(t('roomCreated', { name: room.name }))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  return (
    <Section
      title={space.number || space.name || t('space')}
      hint={area !== null ? t('areaM2', { m2: (area / 1_000_000).toFixed(1) }) : t('spaceLostHint')}
    >
      <TextField
        label={t('number')}
        value={space.number ?? ''}
        maxLength={20}
        placeholder="305"
        disabled={readonly}
        onCommit={(number) => set({ number })}
      />
      <TextField
        label={t('name')}
        value={space.name ?? ''}
        maxLength={100}
        disabled={readonly}
        onCommit={(name) => set({ name })}
      />
      <ChoiceField
        label={t('spaceKind')}
        value={space.kind}
        disabled={readonly}
        options={SPACE_KINDS.map((k) => ({ value: k, label: t(`kind_${k}`) }))}
        onChange={(kind) => set({ kind })}
      />
      <NumberField
        label={t('capacity')}
        value={space.capacity ?? 0}
        min={0}
        max={10_000}
        disabled={readonly}
        onCommit={(v) => set({ capacity: v > 0 ? v : undefined })}
      />
      <ChoiceField
        label={t('visibility')}
        value={space.visibility}
        disabled={readonly}
        options={SPACE_VISIBILITY.map((k) => ({ value: k, label: t(`visibility_${k}`) }))}
        onChange={(visibility) => set({ visibility })}
      />
      <Field label={academic ? t('roomRequired') : t('roomOptional')} id={roomFieldId}>
        <RoomSelect
          id={roomFieldId}
          size="md"
          value={space.roomId ?? null}
          initialLabel={linked?.name ?? null}
          onChange={(roomId) => set({ roomId: roomId ?? undefined })}
        />
      </Field>
      {!space.roomId && (
        <Button
          type="button"
          variant="outline"
          size="md"
          disabled={readonly || createRoom.isPending || !(space.number || space.name)}
          onClick={() => createRoom.mutate()}
        >
          <Link2 aria-hidden />
          {t('createRoom')}
        </Button>
      )}
      {!space.roomId && !(space.number || space.name) && (
        <p className="text-xs text-muted-foreground">{t('createRoomHint')}</p>
      )}
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">{t('splitRooms')}</span>
        <div className="flex items-end gap-2">
          <div className="w-24 shrink-0">
            <NumberField
              label={t('splitCount')}
              value={parts}
              min={2}
              max={50}
              disabled={readonly}
              onCommit={setParts}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="md"
            className="flex-1"
            disabled={readonly}
            onClick={split}
          >
            <Columns3 aria-hidden />
            {t('splitApply')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('splitHint')}</p>
      </div>
      {footer}
    </Section>
  )
}

function ToolSettingsPanel({
  store,
  tools,
  readonly,
}: {
  store: EditorStore
  tools: ToolController
  readonly: boolean
}) {
  const t = useTranslations('CampusEditor')
  // Настройки живут в контроллере; ререндер панели — через пустой set().
  useEditor(store, (s) => s)
  const s = tools.settings
  const change = (patch: Partial<typeof s>) => {
    tools.settings = { ...s, ...patch }
    store.set({})
  }
  // Селектор отдаёт ссылку на документ, а не новый объект: иначе useSyncExternalStore зациклится.
  const doc = useEditor(store, (st) => st.doc)
  const stats = {
    walls: Object.keys(doc.walls).length,
    spaces: Object.keys(doc.spaces).length,
    openings: Object.keys(doc.openings).length,
  }
  return (
    <Section title={t('toolSettings')} hint={t('stats', stats)}>
      <ChoiceField
        label={t('wallKind')}
        value={s.wallKind}
        disabled={readonly}
        options={WALL_KINDS.map((k) => ({ value: k, label: t(`wallKind_${k}`) }))}
        onChange={(wallKind) => change({ wallKind })}
      />
      <NumberField
        label={t('thickness')}
        suffix={t('mm')}
        value={s.wallThicknessMm}
        min={20}
        max={2000}
        step={10}
        onCommit={(v) => change({ wallThicknessMm: v })}
      />
      <NumberField
        label={t('doorWidth')}
        suffix={t('mm')}
        value={s.doorWidthMm}
        min={300}
        max={5000}
        step={10}
        onCommit={(v) => change({ doorWidthMm: v })}
      />
      <NumberField
        label={t('windowWidth')}
        suffix={t('mm')}
        value={s.windowWidthMm}
        min={300}
        max={20_000}
        step={10}
        onCommit={(v) => change({ windowWidthMm: v })}
      />
      <ChoiceField
        label={t('newRoomKind')}
        value={s.spaceKind}
        options={SPACE_KINDS.map((k) => ({ value: k, label: t(`kind_${k}`) }))}
        onChange={(spaceKind) => change({ spaceKind })}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">{t('shortcutsHint')}</p>
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

function CheckRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
    </div>
  )
}
