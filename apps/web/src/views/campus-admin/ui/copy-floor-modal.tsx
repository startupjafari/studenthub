'use client'

import { useState } from 'react'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { cloneFloorPlan, isBareOutlineFloor, levelRenumber } from '@studenthub/campus-core'
import {
  campusKeys,
  fetchCampusPlan,
  saveCampusPlan,
  type CampusBuildingRow,
  type CampusFloorRow,
} from '../../../entities/campus'
import { Badge, Button, Checkbox, Label, Modal, Skeleton } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/**
 * «Сделать остальные этажи такими же»: план этажа копируется на выбранные этажи корпуса с
 * номерами по уровню (А105 на 3-м станет А305). Пустые этажи (одни наружные стены) отмечены
 * сразу, нарисованные — нет: копия их перезапишет, хотя прежний план и останется в снимках.
 * Связь с аудиториями у копий сброшена — её даст «Связать по номерам» в редакторе.
 */
export function CopyFloorModal({
  building,
  source,
  onClose,
}: {
  building: CampusBuildingRow
  source: CampusFloorRow
  onClose: () => void
}) {
  const t = useTranslations('Campus')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const targets = building.floors.filter((f) => f.id !== source.id)
  const plans = useQueries({
    queries: targets.map((f) => ({
      queryKey: campusKeys.plan(f.id),
      queryFn: () => fetchCampusPlan(f.id),
      staleTime: 0,
    })),
  })
  const bare = (i: number): boolean | null => {
    const doc = plans[i]?.data?.document
    return doc ? isBareOutlineFloor(doc, building.outline) : null
  }
  // Выбор человека поверх умолчания: пустые этажи — да, нарисованные — нет.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const isPicked = (f: CampusFloorRow, i: number): boolean => picked[f.id] ?? bare(i) === true
  const chosen = targets.filter((f, i) => isPicked(f, i))
  const loading = plans.some((p) => p.isPending)

  const mut = useMutation({
    mutationFn: async () => {
      const from = await fetchCampusPlan(source.id)
      let done = 0
      for (const f of chosen) {
        // Ревизия — свежая: этаж могли править, пока окно было открыто.
        const current = await fetchCampusPlan(f.id)
        await saveCampusPlan(f.id, {
          baseRevision: current.revision,
          document: cloneFloorPlan(from.document, undefined, {
            renumber: levelRenumber(source.level, f.level),
          }),
        })
        done++
      }
      return done
    },
    onSuccess: (count) => {
      void qc.invalidateQueries({ queryKey: campusKeys.all })
      toast.success(t('copyFloorDone', { count }))
      onClose()
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: campusKeys.all })
      toast.error(tErr(toApiError(e).code))
    },
  })

  return (
    <Modal onClose={onClose} title={t('copyFloorTitle', { label: source.label })} size="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('copyFloorHint')}</p>
        <ul className="flex flex-col">
          {[...targets].reverse().map((f) => {
            const i = targets.indexOf(f)
            const state = bare(i)
            const id = `copy-${f.id}`
            return (
              <li
                key={f.id}
                className="flex items-center gap-3 border-b border-border py-2 last:border-b-0"
              >
                <Checkbox
                  id={id}
                  checked={isPicked(f, i)}
                  disabled={state === null || mut.isPending}
                  onCheckedChange={(v) => setPicked((p) => ({ ...p, [f.id]: v === true }))}
                />
                <Label htmlFor={id} className="min-w-0 flex-1 truncate text-sm font-medium">
                  {t('floorN', { label: f.label })}
                </Label>
                {state === null ? (
                  <Skeleton className="h-5 w-20 rounded-full" />
                ) : state ? (
                  <Badge variant="secondary">{t('floorEmpty')}</Badge>
                ) : (
                  <Badge variant="warning">{t('floorWillOverwrite')}</Badge>
                )}
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            disabled={loading || chosen.length === 0}
            loading={mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('copyFloorApply', { count: chosen.length })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
