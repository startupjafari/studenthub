'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { addCorridorWithRooms } from '@studenthub/campus-core'
import { Button, Modal } from '../../../shared/ui'
import type { EditorStore } from '../model/store'
import type { ToolController } from '../model/tools'
import { ChoiceField, NumberField } from './fields'

/**
 * Шаблон «Коридор с комнатами» (§12.9): самая частая схема учебного корпуса одним действием
 * по габариту уже нарисованных стен. Дальше комнаты правятся обычными инструментами.
 */
export function TemplateModal({
  store,
  tools,
  onClose,
}: {
  store: EditorStore
  tools: ToolController
  onClose: () => void
}) {
  const t = useTranslations('CampusEditor')
  const tCommon = useTranslations('Common')
  const [corridorMm, setCorridor] = useState(2400)
  const [roomWidthMm, setRoomWidth] = useState(6000)
  const [axis, setAxis] = useState<'auto' | 'x' | 'y'>('auto')

  const nodes = Object.values(store.getState().doc.nodes)
  const box = nodes.length
    ? {
        x0: Math.min(...nodes.map((n) => n.x)),
        x1: Math.max(...nodes.map((n) => n.x)),
        y0: Math.min(...nodes.map((n) => n.y)),
        y1: Math.max(...nodes.map((n) => n.y)),
      }
    : null

  const apply = (): void => {
    if (!box) return
    const spec = { thicknessMm: tools.settings.wallThicknessMm, kind: tools.settings.wallKind }
    store.apply('template', (doc) =>
      addCorridorWithRooms(doc, { ...box, corridorMm, roomWidthMm, axis }, spec, store.ids),
    )
    onClose()
  }

  return (
    <Modal onClose={onClose} title={t('templateCorridor')} size="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {box ? t('templateHint') : t('templateNeedsOutline')}
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
        <ChoiceField
          label={t('corridorAxis')}
          value={axis}
          options={(['auto', 'x', 'y'] as const).map((a) => ({ value: a, label: t(`axis_${a}`) }))}
          onChange={setAxis}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={!box} onClick={apply}>
            {t('applyTemplate')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
