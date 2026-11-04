'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { outlineFromShape, type BuildingShape } from '@studenthub/campus-core'
import { campusKeys, createCampusBuilding } from '../../../entities/campus'
import { Button, Input, Label, Modal, SegmentedTabs } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

const SHAPES: BuildingShape[] = ['rect', 'L', 'U', 'T']

/** Метры из поля → целые мм; пустое или мусор — null. */
function mm(value: string): number | null {
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null
}

/**
 * Новый корпус: форма и размеры в метрах, число этажей и высота. Контур строится шаблоном
 * (прямоугольник, «Г», «П», «Т») — каждый этаж сразу получает наружные стены по нему; точную
 * планировку дорисовывают в редакторе этажа.
 */
export function CreateBuildingModal({
  campusId,
  onClose,
}: {
  campusId: string
  onClose: () => void
}) {
  const t = useTranslations('Campus')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [shape, setShape] = useState<BuildingShape>('rect')
  const [width, setWidth] = useState('60')
  const [depth, setDepth] = useState('18')
  const [wing, setWing] = useState('18')
  const [floors, setFloors] = useState('3')
  const [firstLevel, setFirstLevel] = useState('1')
  const [height, setHeight] = useState('3.3')
  const [posX, setPosX] = useState('0')
  const [posY, setPosY] = useState('0')

  const w = mm(width)
  const d = mm(depth)
  const k = mm(wing)
  const h = mm(height)
  const count = Number(floors)
  const first = Number(firstLevel)
  const valid =
    name.trim().length > 0 &&
    w !== null &&
    d !== null &&
    h !== null &&
    (shape === 'rect' || k !== null) &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 60 &&
    Number.isInteger(first)

  const mut = useMutation({
    mutationFn: () =>
      createCampusBuilding(campusId, {
        name: name.trim(),
        code: code.trim() || undefined,
        outline: outlineFromShape(shape, w!, d!, k ?? 0),
        transform: {
          x: Math.round(Number(posX) * 1000) || 0,
          y: Math.round(Number(posY) * 1000) || 0,
          rotationDeg: 0,
        },
        floors: { count, firstLevel: first, heightMm: h! },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campusKeys.tree(campusId) })
      toast.success(t('buildingCreated'))
      onClose()
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint?: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )

  return (
    <Modal onClose={onClose} title={t('addBuilding')} size="lg">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) mut.mutate()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-name">{t('buildingName')}</Label>
            <Input
              id="b-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('buildingNamePlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-code">{t('buildingCode')}</Label>
            <Input
              id="b-code"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="А"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('buildingShape')}</Label>
          <SegmentedTabs
            value={shape}
            onChange={(v) => setShape(v)}
            items={SHAPES.map((s) => ({ value: s, label: t(`shape_${s}`) }))}
            stretch
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('b-width', t('widthM'), width, setWidth)}
          {field('b-depth', t('depthM'), depth, setDepth)}
          {shape !== 'rect' && field('b-wing', t('wingM'), wing, setWing, t('wingHint'))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {field('b-floors', t('floorsCount'), floors, setFloors)}
          {field('b-first', t('firstLevel'), firstLevel, setFirstLevel, t('firstLevelHint'))}
          {field('b-height', t('floorHeightM'), height, setHeight)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('b-x', t('positionX'), posX, setPosX)}
          {field('b-y', t('positionY'), posY, setPosY)}
        </div>
        <p className="text-xs text-muted-foreground">{t('buildingHint')}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!valid} loading={mut.isPending}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
