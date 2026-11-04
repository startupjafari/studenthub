'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { campusKeys, createCampusFloor, type CampusBuildingRow } from '../../../entities/campus'
import {
  Button,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

const EMPTY = '__empty__'

/**
 * Новый этаж корпуса: пустой (наружные стены по контуру) или копия существующего — типовые
 * этажи рисуются один раз (§12.7). У копии связь с Room сброшена, номера сдвигаются маской.
 */
export function AddFloorModal({
  campusId,
  building,
  onClose,
}: {
  campusId: string
  building: CampusBuildingRow
  onClose: () => void
}) {
  const t = useTranslations('Campus')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const top = building.floors.reduce((m, f) => Math.max(m, f.level), 0)
  const [level, setLevel] = useState(String(top + 1))
  const [label, setLabel] = useState('')
  const [copyFrom, setCopyFrom] = useState<string>(building.floors.at(-1)?.id ?? EMPTY)
  const source = building.floors.find((f) => f.id === copyFrom)
  const [renumberFrom, setRenumberFrom] = useState(source ? String(source.level) : '')
  const [renumberTo, setRenumberTo] = useState(String(top + 1))
  const lvl = Number(level)
  const valid =
    Number.isInteger(lvl) &&
    lvl >= -5 &&
    lvl <= 100 &&
    !building.floors.some((f) => f.level === lvl)

  const mut = useMutation({
    mutationFn: () =>
      createCampusFloor(building.id, {
        level: lvl,
        label: label.trim() || undefined,
        ...(copyFrom !== EMPTY
          ? {
              copyFromFloorId: copyFrom,
              ...(renumberFrom.trim() && renumberTo.trim()
                ? { renumber: { from: renumberFrom.trim(), to: renumberTo.trim() } }
                : {}),
            }
          : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campusKeys.tree(campusId) })
      onClose()
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  return (
    <Modal onClose={onClose} title={t('addFloor')} size="md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) mut.mutate()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-level">{t('level')}</Label>
            <Input
              id="f-level"
              inputMode="numeric"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              aria-invalid={!valid}
            />
            {!valid && <p className="text-xs text-destructive">{t('levelTaken')}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-label">{t('floorLabel')}</Label>
            <Input
              id="f-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={level}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-copy">{t('copyFrom')}</Label>
          <Select
            value={copyFrom}
            onValueChange={(v) => {
              setCopyFrom(v)
              const f = building.floors.find((x) => x.id === v)
              setRenumberFrom(f ? String(f.level) : '')
            }}
          >
            <SelectTrigger id="f-copy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY}>{t('emptyFloor')}</SelectItem>
              {building.floors.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {t('floorN', { label: f.label })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {copyFrom !== EMPTY && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('renumber')}</Label>
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('renumberFrom')}
                className="w-20"
                value={renumberFrom}
                onChange={(e) => setRenumberFrom(e.target.value)}
              />
              <span aria-hidden>→</span>
              <Input
                aria-label={t('renumberTo')}
                className="w-20"
                value={renumberTo}
                onChange={(e) => setRenumberTo(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('renumberHint')}</p>
          </div>
        )}
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
