'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Printer } from 'lucide-react'
import {
  Button,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import {
  fetchAllRooms,
  issueRoomQrRequest,
  roomKeys,
  type Room,
  type RoomQr,
} from '../../../entities/room'
import type { QrSheetLayout } from './room-qr-sheet'

// Печать наклеек пачкой на корпус или этаж (docs/PROJECT.md §3.9): вуз обходит корпус и
// клеит коды десятками. Код выдаётся идемпотентно — у помещения с наклейкой он не меняется,
// поэтому повторная печать корпуса не обесценивает уже висящие наклейки.

// Radix Select не принимает пустое значение: «без корпуса» и «все этажи» — свои метки.
const NO_BUILDING = '__none__'
const ALL_FLOORS = '__all__'
// Столько помещений сервер выдаёт за один запрос пачки (RoomQrBatchSchema).
const BATCH_MAX = 200

function buildingOf(room: Room): string {
  return room.building ?? NO_BUILDING
}

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function PrintBatchModal({
  onClose,
  onReady,
}: {
  onClose: () => void
  /** Коды выданы — лист готов к печати. */
  onReady: (items: RoomQr[], layout: QrSheetLayout) => void
}) {
  const t = useTranslations('Rooms')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const rooms = useQuery({ queryKey: roomKeys.everything(), queryFn: fetchAllRooms })
  const [building, setBuilding] = useState<string | null>(null)
  const [floor, setFloor] = useState(ALL_FLOORS)
  const [layout, setLayout] = useState<QrSheetLayout>('compact')

  const all = rooms.data ?? []
  const buildings = [...new Set(all.map(buildingOf))].sort((a, b) =>
    a === NO_BUILDING ? 1 : b === NO_BUILDING ? -1 : a.localeCompare(b),
  )
  const chosen = building ?? buildings[0] ?? null
  const inBuilding = all.filter((r) => buildingOf(r) === chosen)
  const floors = [
    ...new Set(inBuilding.map((r) => r.floor).filter((f): f is number => f !== null)),
  ].sort((a, b) => a - b)
  const picked = inBuilding.filter((r) => floor === ALL_FLOORS || String(r.floor) === floor)

  const print = useMutation({
    mutationFn: async (ids: string[]) => {
      const chunks: string[][] = []
      for (let i = 0; i < ids.length; i += BATCH_MAX) chunks.push(ids.slice(i, i + BATCH_MAX))
      const results: RoomQr[] = []
      for (const chunk of chunks) results.push(...(await issueRoomQrRequest(chunk)))
      return results
    },
    onSuccess: (items) => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      onReady(items, layout)
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  return (
    <Modal onClose={onClose} title={t('batchTitle')} size="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('batchHint')}</p>
        {rooms.isPending ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="batch-building">{t('building')}</Label>
                <Select
                  value={chosen ?? undefined}
                  onValueChange={(v) => {
                    setBuilding(v)
                    setFloor(ALL_FLOORS)
                  }}
                >
                  <SelectTrigger id="batch-building">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {buildings.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b === NO_BUILDING ? t('batchNoBuilding') : b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="batch-floor">{t('floor')}</Label>
                <Select value={floor} onValueChange={setFloor}>
                  <SelectTrigger id="batch-floor">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FLOORS}>{t('batchAllFloors')}</SelectItem>
                    {floors.map((f) => (
                      <SelectItem key={f} value={String(f)}>
                        {t('floorValue', { value: f })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="batch-layout">{t('batchLayout')}</Label>
              <Select value={layout} onValueChange={(v) => setLayout(v as QrSheetLayout)}>
                <SelectTrigger id="batch-layout">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">{t('layoutCompact')}</SelectItem>
                  <SelectItem value="full">{t('layoutFull')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm">{t('batchCount', { count: picked.length })}</p>
          </>
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            disabled={picked.length === 0}
            loading={print.isPending}
            onClick={() => print.mutate(picked.map((r) => r.id))}
          >
            <Printer className="size-4" aria-hidden />
            {t('print')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
