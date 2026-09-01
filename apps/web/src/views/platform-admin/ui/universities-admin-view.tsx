'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Building2, Plus } from 'lucide-react'
import { type UniversityStatusValue } from '@studenthub/shared-schemas'
import {
  fetchUniversities,
  setUniversityStatusRequest,
  universityKeys,
  type University,
} from '../../../entities/university'
import { useKatoNames } from '../../../entities/kato'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { CreateUniversityModal } from './create-university-modal'

const STATUSES: UniversityStatusValue[] = ['PENDING', 'ACTIVE', 'BLOCKED']
const STATUS_STYLE: Record<UniversityStatusValue, string> = {
  PENDING: 'text-warning',
  ACTIVE: 'text-success',
  BLOCKED: 'text-destructive',
}
// Порядок статусов при сортировке — «жизненный», а не алфавитный: сначала то, что
// требует решения (ожидает), потом рабочие, потом отключённые.
const STATUS_RANK: Record<UniversityStatusValue, number> = { PENDING: 0, ACTIVE: 1, BLOCKED: 2 }

// Ширины: название · аббревиатура · город · создан · статус (селект).
const COLS = ['30%', '14%', '20%', '14%', '22%'] as const
// Узкий экран: аббревиатура и дата скрыты, их доли уходят названию и статусу.
const COLS_NARROW = ['48%', '0', '0', '0', '52%'] as const
const HIDE = {
  shortName: 'hidden md:table-cell',
  city: 'hidden sm:table-cell',
  createdAt: 'hidden lg:table-cell',
} as const
// Порядок = порядок колонок: скелетон обязан прятать те же колонки, что и шапка,
// иначе во время загрузки колонки разъезжаются.
const SKELETON_COLS = [undefined, HIDE.shortName, HIDE.city, HIDE.createdAt, undefined]

interface Row extends University {
  cityLabel: string | null
}

// Аксессор сортировки — вне компонента: он в зависимостях `useMemo` внутри `useTableSort`.
// Город и дата сортируются по резолвнутым значениям, а не по коду КАТО и строке ISO.
function sortValue(row: Row, key: string): unknown {
  switch (key) {
    case 'name':
      return row.name
    case 'shortName':
      return row.shortName
    case 'city':
      return row.cityLabel
    case 'createdAt':
      return Date.parse(row.createdAt)
    case 'status':
      return STATUS_RANK[row.status]
    default:
      return null
  }
}

export function UniversitiesAdminView() {
  const t = useTranslations('Universities')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)

  const universities = useQuery({ queryKey: universityKeys.list(), queryFn: fetchUniversities })
  const list = universities.data ?? []

  // `city` хранит код КАТО. Резолвим весь список одним запросом — запрос на строку дал бы N+1.
  const { nameOf: cityName } = useKatoNames(list.map((u) => u.city))

  // Вузов на платформе десятки, не тысячи — сборку строк не мемоизируем (`nameOf` всё равно
  // новая функция на каждый рендер, и мемо пересчитывался бы каждый раз).
  const rows: Row[] = list.map((u) => ({ ...u, cityLabel: cityName(u.city) ?? null }))

  // Сортировка клиентская: список приходит целиком (вузов на платформе десятки),
  // пагинации нет — сортируются все строки, а не открытая страница.
  const { rows: sorted, sort, toggle } = useTableSort(rows, sortValue)

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UniversityStatusValue }) =>
      setUniversityStatusRequest(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: universityKeys.list() })
      toast.success(t('statusChanged'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      {/* Создание — кнопка в шапке и модалка: постоянная форма наверху страницы
          отодвигала сам список вниз, хотя вуз добавляют редко. */}
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button size="md" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('add')}
          </Button>
        }
      />

      {createOpen && <CreateUniversityModal onClose={() => setCreateOpen(false)} />}

      {universities.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !universities.isLoading && sorted.length === 0 ? (
        <EmptyState icon={<Building2 className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={toggle}>
                  {t('name')}
                </TableHead>
                <TableHead
                  sortKey="shortName"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.shortName}
                >
                  {t('shortName')}
                </TableHead>
                <TableHead sortKey="city" sort={sort} onSort={toggle} className={HIDE.city}>
                  {t('city')}
                </TableHead>
                <TableHead
                  sortKey="createdAt"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.createdAt}
                >
                  {t('createdAt')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle}>
                  {t('status')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {universities.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {sorted.map((u) => (
                <TableRow key={u.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <TableText value={u.name} />
                    {/* На узком экране колонки аббревиатуры и города скрыты — город
                        уходит подписью под название, чтобы не терялся совсем. */}
                    {u.cityLabel && (
                      <span className="block truncate text-xs font-normal text-muted-foreground sm:hidden">
                        {u.cityLabel}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={HIDE.shortName}>
                    {u.shortName ? <TableText value={u.shortName} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell className={HIDE.city}>
                    {u.cityLabel ? <TableText value={u.cityLabel} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell className={cn('tabular-nums', HIDE.createdAt)}>
                    {new Date(u.createdAt).toLocaleDateString(locale, {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </TableCell>
                  {/* Статус — сразу селект: смена статуса это основное действие экрана,
                      отдельная колонка «только прочитать» дублировала бы значение. */}
                  <TableCell>
                    <Select
                      value={u.status}
                      onValueChange={(v) =>
                        statusMut.mutate({ id: u.id, status: v as UniversityStatusValue })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t('status')}
                        className={cn('font-medium', STATUS_STYLE[u.status])}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`status${s}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* Пагинации нет — вместо неё счётчик: видно, что список показан целиком. */}
          <div className="border-t border-border px-4 py-2 text-sm text-muted-foreground">
            {t('count', { n: sorted.length })}
          </div>
        </Card>
      )}
    </div>
  )
}
