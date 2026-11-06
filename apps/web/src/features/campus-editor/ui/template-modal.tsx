'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  addCorridorWithRooms,
  autoLayout,
  isBareOutlineFloor,
  type Pt,
  type SpaceKind,
} from '@studenthub/campus-core'
import { Button, Modal, SegmentedTabs, useConfirm } from '../../../shared/ui'
import type { EditorStore } from '../model/store'
import type { ToolController } from '../model/tools'
import { ChoiceField, NumberField } from '../../../entities/campus'

type Mode = 'auto' | 'corridor'

/** Назначения обычных кабинетов автопланировки. */
const ROOM_KINDS: SpaceKind[] = ['office', 'auditorium', 'lab', 'computer_lab']

/**
 * Шаблоны планировки (§12.9). «Автопланировка» раскладывает весь этаж по контуру корпуса:
 * коридоры, кабинеты, лестницы, туалеты, лифты, двери и окна — одним шагом, Ctrl+Z вернёт
 * как было. «Коридор с комнатами» — прежний шаблон по габариту уже нарисованных стен.
 */
export function TemplateModal({
  store,
  tools,
  outline,
  level,
  onClose,
}: {
  store: EditorStore
  tools: ToolController
  /** Контур корпуса в мм корпуса — для автопланировки. */
  outline: Pt[] | null
  level: number
  onClose: () => void
}) {
  const t = useTranslations('CampusEditor')
  const tCommon = useTranslations('Common')
  const confirm = useConfirm()
  const [mode, setMode] = useState<Mode>(outline ? 'auto' : 'corridor')
  const [corridorMm, setCorridor] = useState(2400)
  const [roomWidthMm, setRoomWidth] = useState(6000)
  const [axis, setAxis] = useState<'auto' | 'x' | 'y'>('auto')
  const [roomKind, setRoomKind] = useState<SpaceKind>('office')
  const [lifts, setLifts] = useState(2)
  const [error, setError] = useState<string | null>(null)

  const nodes = Object.values(store.getState().doc.nodes)
  const box = nodes.length
    ? {
        x0: Math.min(...nodes.map((n) => n.x)),
        x1: Math.max(...nodes.map((n) => n.x)),
        y0: Math.min(...nodes.map((n) => n.y)),
        y1: Math.max(...nodes.map((n) => n.y)),
      }
    : null

  const applyCorridor = (): void => {
    if (!box) return
    const spec = { thicknessMm: tools.settings.wallThicknessMm, kind: tools.settings.wallKind }
    store.apply('template', (doc) =>
      addCorridorWithRooms(doc, { ...box, corridorMm, roomWidthMm, axis }, spec, store.ids),
    )
    onClose()
  }

  const applyAuto = async (): Promise<void> => {
    if (!outline) return
    const result = autoLayout(outline, {
      level,
      corridorMm,
      roomWidthMm,
      roomKind,
      lifts,
      partition: { thicknessMm: tools.settings.wallThicknessMm, kind: 'wall' },
    })
    if ('error' in result) {
      setError(t(`autoError_${result.error}`))
      return
    }
    // Нарисованное не теряется молча: пустой этаж заменяем сразу, остальное — с вопросом.
    if (!isBareOutlineFloor(store.getState().doc, outline)) {
      const ok = await confirm({
        title: t('autoReplaceConfirm'),
        description: t('autoReplaceHint'),
      })
      if (!ok) return
    }
    store.apply('autoLayout', () => result.doc)
    onClose()
  }

  return (
    <Modal onClose={onClose} title={t('templates')} size="md">
      <div className="flex flex-col gap-4">
        <SegmentedTabs
          aria-label={t('templates')}
          stretch
          collapsible={false}
          value={mode}
          onChange={(m) => {
            setMode(m)
            setError(null)
          }}
          items={[
            { value: 'auto', label: t('templateAuto') },
            { value: 'corridor', label: t('templateCorridor') },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {mode === 'auto'
            ? outline
              ? t('templateAutoHint')
              : t('templateNeedsBuilding')
            : box
              ? t('templateHint')
              : t('templateNeedsOutline')}
        </p>
        <NumberField
          label={t('corridorWidth')}
          suffix={t('mm')}
          value={corridorMm}
          min={1200}
          max={10_000}
          step={100}
          onCommit={setCorridor}
        />
        <NumberField
          label={t('roomWidth')}
          suffix={t('mm')}
          value={roomWidthMm}
          min={2000}
          max={30_000}
          step={100}
          onCommit={setRoomWidth}
        />
        {mode === 'auto' ? (
          <>
            <ChoiceField
              label={t('autoRoomKind')}
              value={roomKind}
              options={ROOM_KINDS.map((k) => ({ value: k, label: t(`kind_${k}`) }))}
              onChange={setRoomKind}
            />
            <ChoiceField
              label={t('autoLifts')}
              value={String(lifts)}
              options={['0', '1', '2', '3', '4'].map((v) => ({ value: v, label: v }))}
              onChange={(v) => setLifts(Number(v))}
            />
          </>
        ) : (
          <ChoiceField
            label={t('corridorAxis')}
            value={axis}
            options={(['auto', 'x', 'y'] as const).map((a) => ({
              value: a,
              label: t(`axis_${a}`),
            }))}
            onChange={setAxis}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            disabled={mode === 'auto' ? !outline : !box}
            onClick={() => (mode === 'auto' ? void applyAuto() : applyCorridor())}
          >
            {t('applyTemplate')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
