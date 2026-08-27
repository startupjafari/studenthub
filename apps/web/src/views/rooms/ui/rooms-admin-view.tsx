'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { DoorClosed, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react'
import type { RoomSortValue } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useConfirm,
  useSortState,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { CreateRoomModal } from './create-room-modal'
import {
  deleteRoomRequest,
  fetchRoomsSorted,
  issueRoomQrRequest,
  roomKeys,
  rotateRoomQrRequest,
  type Room,
  type RoomQr,
} from '../../../entities/room'
import { RoomQrSheet } from './room-qr-sheet'
import { formatRoomCode } from '../lib/format-code'

// Ф16: экран администратора вуза — помещения и печатные QR над дверью.
// До этой задачи помещения создавались только через API: экрана не было вовсе,
// хотя POST /rooms существовал с Ф5.

// Ширины колонок: название · назначение · корпус · этаж · вместимость · QR · действия.
// Потолок 100 — столько разрешает OffsetPaginationSchema, на которой построен GET /rooms.
const PAGE_SIZES = [20, 50, 100] as const
const ROOM_COLS = ['24%', '16%', '14%', '8%', '10%', '15%', '13rem'] as const
// На узком экране остаются название, QR и действия — то, ради чего сюда приходят.
const HIDE = {
  kind: 'hidden md:table-cell',
  building: 'hidden lg:table-cell',
  floor: 'hidden xl:table-cell',
  capacity: 'hidden xl:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [
  undefined,
  HIDE.kind,
  HIDE.building,
  HIDE.floor,
  HIDE.capacity,
  undefined,
  undefined,
]

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function RoomsAdminView() {
  const t = useTranslations('Rooms')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  // Что уходит в печать. Пусто — печатать нечего, лист не рендерим.
  const [sheet, setSheet] = useState<RoomQr[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  // Сортировка серверная: упорядочена вся выборка, а не открытая страница.
  const { sort, toggle: toggleSort } = useSortState()
  const roomQuery = {
    page,
    limit,
    ...(sort ? { sort: sort.key as RoomSortValue, order: sort.dir } : {}),
  }
  const rooms = useQuery({
    queryKey: roomKeys.list(roomQuery),
    queryFn: () => fetchRoomsSorted(roomQuery),
    placeholderData: (prev) => prev,
  })

  const [createOpen, setCreateOpen] = useState(false)

  const deleteMut = useMutation({
    mutationFn: deleteRoomRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => {
      // Помещение занято в расписании — удалять нельзя (иначе пары «потеряют» аудиторию).
      const code = errCode(e)
      toast.error(code === 'CONFLICT' ? t('deleteBlocked') : tErr(code))
    },
  })

  const printMut = useMutation({
    mutationFn: issueRoomQrRequest,
    onSuccess: (items) => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      setSheet(items)
      // Даём React отрисовать лист до вызова печати — иначе печатается пустая страница.
      requestAnimationFrame(() => window.print())
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const rotateMut = useMutation({
    mutationFn: rotateRoomQrRequest,
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: roomKeys.all })
      setSheet([item])
      toast.success(t('rotated'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const items = rooms.data?.items ?? []
  const total = rooms.data?.total ?? 0

  const sorted = items

  const rotate = async (room: Room): Promise<void> => {
    // Перевыпуск обесценивает уже расклеенные наклейки — спрашиваем явно.
    const ok = await confirm({
      title: t('rotateConfirmTitle'),
      description: t('rotateConfirmDesc', { room: room.name }),
      confirmLabel: t('rotateConfirmAction'),
      destructive: true,
    })
    if (ok) rotateMut.mutate(room.id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Цепочка flex до таблицы: `fill` у Table требует, чтобы каждый предок отдавал ей
          высоту, иначе прокручивается страница целиком, а не тело таблицы. */}
      <div className="sh-no-print flex min-h-0 flex-1 flex-col gap-6">
        <PageHeader
          title={t('adminTitle')}
          subtitle={t('adminDescription')}
          actions={
            <Button type="button" size="md" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t('addRoom')}
            </Button>
          }
        />

        {!rooms.isPending && total === 0 ? (
          <EmptyState
            icon={<DoorClosed className="size-8" aria-hidden />}
            title={t('emptyTitle')}
            description={t('emptyDesc')}
            action={
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                {t('addRoom')}
              </Button>
            }
          />
        ) : (
          // `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой таблицы
          // и просвет под последней строкой — таблица занимает карточку целиком.
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={ROOM_COLS}>
              <TableHeader>
                <TableRow>
                  <TableHead sortKey="name" sort={sort} onSort={toggleSort}>
                    {t('name')}
                  </TableHead>
                  <TableHead sortKey="kind" sort={sort} onSort={toggleSort} className={HIDE.kind}>
                    {t('kindLabel')}
                  </TableHead>
                  <TableHead
                    sortKey="building"
                    sort={sort}
                    onSort={toggleSort}
                    className={HIDE.building}
                  >
                    {t('building')}
                  </TableHead>
                  <TableHead
                    numeric
                    sortKey="floor"
                    sort={sort}
                    onSort={toggleSort}
                    className={HIDE.floor}
                  >
                    {t('floor')}
                  </TableHead>
                  <TableHead
                    numeric
                    sortKey="capacity"
                    sort={sort}
                    onSort={toggleSort}
                    className={HIDE.capacity}
                  >
                    {t('capacity')}
                  </TableHead>
                  <TableHead sortKey="qr" sort={sort} onSort={toggleSort}>
                    {t('qrColumn')}
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t('actionsColumn')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
                {sorted.map((room) => (
                  <TableRow key={room.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <TableText value={room.name} />
                    </TableCell>
                    <TableCell className={cn(HIDE.kind, 'text-muted-foreground')}>
                      <TableText value={t(`kind.${room.kind}`)} />
                    </TableCell>
                    <TableCell className={cn(HIDE.building, 'text-muted-foreground')}>
                      {room.building ? <TableText value={room.building} /> : <TableEmpty />}
                    </TableCell>
                    <TableCell
                      className={cn(HIDE.floor, 'text-right text-muted-foreground tabular-nums')}
                    >
                      {room.floor !== null ? room.floor : <TableEmpty />}
                    </TableCell>
                    <TableCell
                      className={cn(HIDE.capacity, 'text-right text-muted-foreground tabular-nums')}
                    >
                      {room.capacity !== null ? room.capacity : <TableEmpty />}
                    </TableCell>
                    <TableCell>
                      {room.qrCode ? (
                        <Badge variant="secondary" className="font-mono">
                          {formatRoomCode(room.qrCode)}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{t('noQr')}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {/* Печать одного помещения: выделять его чекбоксом не нужно. */}
                        <Button
                          variant="outline"
                          size="sm"
                          loading={
                            printMut.isPending &&
                            printMut.variables?.length === 1 &&
                            printMut.variables[0] === room.id
                          }
                          onClick={() => printMut.mutate([room.id])}
                        >
                          <Printer className="size-4" aria-hidden />
                          {t('print')}
                        </Button>
                        {room.qrCode && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon
                            aria-label={t('rotate')}
                            title={t('rotate')}
                            onClick={() => void rotate(room)}
                          >
                            <RefreshCw className="size-4" aria-hidden />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={t('delete')}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('deleteConfirmTitle'),
                              description: t('deleteConfirmDesc', { room: room.name }),
                              destructive: true,
                            })
                            if (ok) deleteMut.mutate(room.id)
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              total={total}
              limit={limit}
              onPageChange={setPage}
              limitOptions={PAGE_SIZES}
              onLimitChange={(n) => {
                setLimit(n)
                setPage(1)
              }}
            />
          </Card>
        )}
      </div>

      {createOpen && <CreateRoomModal onClose={() => setCreateOpen(false)} />}

      {/* Лист для печати: на экране скрыт, при печати — единственное, что попадает на бумагу. */}
      {/* Раскладка всегда «по одной на лист»: печать теперь только для одного помещения,
          режим «4 на лист» имел смысл только при массовом выборе. */}
      {sheet.length > 0 && <RoomQrSheet items={sheet} layout="full" />}
    </div>
  )
}
