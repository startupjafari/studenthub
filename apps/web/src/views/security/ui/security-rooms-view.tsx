'use client'

import { useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { DoorClosed } from 'lucide-react'
import type { RoomSortValue } from '@studenthub/shared-schemas'
import {
  Button,
  Card,
  EmptyState,
  Input,
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
  useSortState,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { fetchRoomsSorted, roomKeys } from '../../../entities/room'

// Справочник помещений для охраны: где что находится, часы работы и телефон. Только
// чтение — тот же GET /rooms, что у таблицы администратора, без печати и правки.
// Название ведёт на страницу помещения «что сейчас идёт», если у него выдан QR.

const PAGE_SIZES = [20, 50, 100] as const
// название · назначение · корпус · этаж · часы работы · телефон
const COLS = ['24%', '16%', '12%', '8%', '22%', '18%'] as const
const COLS_NARROW = ['50%', '0', '0', '0', '50%', '0'] as const
const HIDE = {
  kind: 'hidden md:table-cell',
  building: 'hidden lg:table-cell',
  floor: 'hidden lg:table-cell',
  phone: 'hidden md:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.kind, HIDE.building, HIDE.floor, undefined, HIDE.phone]

export function SecurityRoomsView() {
  const t = useTranslations('Rooms')
  const tSecurity = useTranslations('Security')
  const tErr = useTranslations('Errors')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const { sort, toggle } = useSortState()

  // Обрезаем при запросе, а не при вводе: иначе пробел не ввести — «Корпус А» → «КорпусА».
  const term = search.trim()
  const query = {
    page,
    limit,
    ...(term ? { search: term } : {}),
    ...(sort ? { sort: sort.key as RoomSortValue, order: sort.dir } : {}),
  }
  const rooms = useQuery({
    queryKey: roomKeys.list(query),
    queryFn: () => fetchRoomsSorted(query),
    placeholderData: keepPreviousData,
  })
  const items = rooms.data?.items ?? []
  const total = rooms.data?.total ?? 0

  // Новый поиск или порядок — с первой страницы: на «странице 3» новой выборки строк
  // может не быть вовсе.
  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <PageHeader
        title={tSecurity('roomsTitle')}
        subtitle={tSecurity('roomsSubtitle')}
        actions={
          <Input
            value={search}
            onChange={(e) => refilter(() => setSearch(e.target.value))}
            placeholder={tSecurity('roomsSearch')}
            aria-label={tSecurity('roomsSearch')}
            size="md"
            className="w-40 sm:w-56"
          />
        }
      />

      {rooms.isError ? (
        <EmptyState
          icon={<DoorClosed className="size-8" aria-hidden />}
          title={tErr((rooms.error as { code?: string }).code ?? 'INTERNAL_ERROR')}
          action={
            <Button type="button" variant="outline" onClick={() => void rooms.refetch()}>
              {tSecurity('retry')}
            </Button>
          }
        />
      ) : !rooms.isPending && total === 0 ? (
        <EmptyState
          icon={<DoorClosed className="size-8" aria-hidden />}
          title={search ? tSecurity('roomsNotFound') : t('emptyTitle')}
          description={search ? undefined : tSecurity('roomsEmptyHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={(k) => refilter(() => toggle(k))}>
                  {t('name')}
                </TableHead>
                <TableHead
                  sortKey="kind"
                  sort={sort}
                  onSort={(k) => refilter(() => toggle(k))}
                  className={HIDE.kind}
                >
                  {t('kindLabel')}
                </TableHead>
                <TableHead
                  sortKey="building"
                  sort={sort}
                  onSort={(k) => refilter(() => toggle(k))}
                  className={HIDE.building}
                >
                  {t('building')}
                </TableHead>
                <TableHead
                  numeric
                  sortKey="floor"
                  sort={sort}
                  onSort={(k) => refilter(() => toggle(k))}
                  className={HIDE.floor}
                >
                  {t('floor')}
                </TableHead>
                <TableHead>{t('openHours')}</TableHead>
                <TableHead className={HIDE.phone}>{t('phone')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((room) => (
                <TableRow key={room.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    {room.qrCode ? (
                      <Link
                        href={`/r/${room.qrCode}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        <TableText value={room.name} />
                      </Link>
                    ) : (
                      <TableText value={room.name} />
                    )}
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
                  <TableCell className="text-muted-foreground">
                    {room.openHours ? <TableText value={room.openHours} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell className={cn(HIDE.phone, 'text-muted-foreground')}>
                    {room.phone ? (
                      <a href={`tel:${room.phone}`} className="hover:underline">
                        <TableText value={room.phone} />
                      </a>
                    ) : (
                      <TableEmpty />
                    )}
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
  )
}
