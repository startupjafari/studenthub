'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { Pt } from '@studenthub/campus-core'
import { createCampusBuilding, type CampusBuildingRow } from '../../../entities/campus'
import { Button, Input, Label, Modal } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/** Буквы корпусов по порядку — как их обычно и называют: А, Б, В… */
const LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ'

/** Первая свободная буква: новый корпус сразу получает код, номера помещений — префикс. */
export function nextBuildingCode(taken: (string | null)[]): string {
  const used = new Set(taken.filter(Boolean).map((c) => c!.toUpperCase()))
  return [...LETTERS].find((l) => !used.has(l)) ?? ''
}

/**
 * Новый корпус по обведённому на территории контуру: только название, буква и этажность —
 * остальное по умолчанию (нижний этаж первый, высота 3,3 м) и спрятано под «Дополнительно».
 * Каждый этаж сразу получает наружные стены по контуру.
 */
export function NewBuildingDialog({
  campusId,
  outline,
  takenCodes,
  onCreated,
  onClose,
}: {
  campusId: string
  /** Контур в мм кампуса — как нарисовали. */
  outline: Pt[]
  takenCodes: (string | null)[]
  onCreated: (building: CampusBuildingRow, floors: number) => void
  onClose: () => void
}) {
  const t = useTranslations('Campus')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const [code, setCode] = useState(() => nextBuildingCode(takenCodes))
  const [name, setName] = useState(() => t('defaultBuildingName', { code }))
  const [nameTouched, setNameTouched] = useState(false)
  const [floors, setFloors] = useState('1')
  const [firstLevel, setFirstLevel] = useState('1')
  const [height, setHeight] = useState('3.3')

  const count = Number(floors)
  const first = Number(firstLevel)
  const heightMm = Math.round(Number(height.replace(',', '.')) * 1000)
  const valid =
    name.trim().length > 0 &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 60 &&
    Number.isInteger(first) &&
    first >= -5 &&
    first <= 100 &&
    heightMm >= 2000 &&
    heightMm <= 20_000

  // Контур — в системе корпуса от левого нижнего угла: так же, как у корпусов из шаблонов.
  const minX = Math.min(...outline.map((p) => p.x))
  const minY = Math.min(...outline.map((p) => p.y))

  const mut = useMutation({
    mutationFn: () =>
      createCampusBuilding(campusId, {
        name: name.trim(),
        code: code.trim() || undefined,
        outline: outline.map((p) => ({ x: p.x - minX, y: p.y - minY })),
        transform: { x: minX, y: minY, rotationDeg: 0 },
        floors: { count, firstLevel: first, heightMm },
      }),
    onSuccess: (building) => onCreated(building, count),
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
    <Modal onClose={onClose} title={t('newBuildingTitle')} size="md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) mut.mutate()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nb-name">{t('buildingName')}</Label>
            <Input
              id="nb-name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nb-code">{t('buildingCode')}</Label>
            <Input
              id="nb-code"
              maxLength={10}
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                // Название по умолчанию следует за буквой, пока его не правили руками.
                if (!nameTouched) setName(t('defaultBuildingName', { code: e.target.value }))
              }}
            />
          </div>
        </div>
        {field('nb-floors', t('floorsCount'), floors, setFloors)}
        <details className="group flex flex-col gap-3">
          <summary className="cursor-pointer text-sm text-muted-foreground select-none hover:text-foreground">
            {t('moreOptions')}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {field('nb-first', t('firstLevel'), firstLevel, setFirstLevel, t('firstLevelHint'))}
            {field('nb-height', t('floorHeightM'), height, setHeight)}
          </div>
        </details>
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
