'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Building2, Plus } from 'lucide-react'
import {
  ADMIN_PAGE_SIZES,
  type UniversitySortValue,
  type UniversityStatusValue,
} from '@studenthub/shared-schemas'
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
  Input,
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
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useSortState,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { CreateUniversityModal } from './create-university-modal'

const STATUSES: UniversityStatusValue[] = ['PENDING', 'ACTIVE', 'BLOCKED']
const STATUS_STYLE: Record<UniversityStatusValue, string> = {
  PENDING: 'text-warning',
  ACTIVE: 'text-success',
  BLOCKED: 'text-destructive',
}
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

// Размеры страницы — те же, что разрешает серверная схема (предел 200).
const PAGE_SIZES = ADMIN_PAGE_SIZES

export function UniversitiesAdminView() {
  const t = useTranslations('Universities')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  // Сортировка серверная (sort/order в запросе) — упорядочены все вузы выборки,
  // а не только открытая страница.
  const { sort, toggle } = useSortState()

  const query = {
    page,
    limit,
    ...(search ? { search } : {}),
    ...(sort ? { sort: sort.key as UniversitySortValue, order: sort.dir } : {}),
  }

  const universities = useQuery({
    queryKey: universityKeys.list(query),
    queryFn: () => fetchUniversities(query),
    // Прошлая страница остаётся на экране, пока грузится новая: иначе таблица
    // мигает скелетоном на каждый клик по стрелке.
    placeholderData: keepPreviousData,
  })
  const list = universities.data?.items ?? []
  const total = universities.data?.total ?? 0

  // `city` хранит код КАТО. Резолвим страницу одним запросом — запрос на строку дал бы N+1.
  const { nameOf: cityName } = useKatoNames(list.map((u) => u.city))

  // На странице два десятка строк — сборку не мемоизируем (`nameOf` всё равно новая
  // функция на каждый рендер, и мемо пересчитывался бы каждый раз).
  const rows: Row[] = list.map((u) => ({ ...u, cityLabel: cityName(u.city) ?? null }))

  // Новый поиск или порядок — снова с первой страницы: на «странице 7» отфильтрованной
  // выборки может не быть строк вовсе, а после смены сортировки там уже другие строки.
  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }
  const sortBy = (key: string): void => refilter(() => toggle(key))

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UniversityStatusValue }) =>
      setUniversityStatusRequest(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: universityKeys.all })
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
          <>
            {/* Поиск — в шапке (DESIGN_SYSTEM §10.1): это управление списком, отдельной
                строки над таблицей оно не заслуживает. Ищет сервер по названию и
                аббревиатуре, по всей выборке, а не по открытой странице. */}
            <Input
              value={search}
              onChange={(e) => refilter(() => setSearch(e.target.value.trim()))}
              placeholder={t('searchPlaceholder')}
              size="md"
              className="w-40 sm:w-56"
            />
            <Button size="md" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t('add')}
            </Button>
          </>
        }
      />

      {createOpen && <CreateUniversityModal onClose={() => setCreateOpen(false)} />}

      {universities.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !universities.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" aria-hidden />}
          title={search ? t('nothingFound') : t('empty')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={sortBy}>
                  {t('name')}
                </TableHead>
                <TableHead
                  sortKey="shortName"
                  sort={sort}
                  onSort={sortBy}
                  className={HIDE.shortName}
                >
                  {t('shortName')}
                </TableHead>
                {/* Город без сортировки: в базе лежит код КАТО, а в ячейке — название.
                    Сортировка по коду выстроила бы строки по регионам, а не по алфавиту
                    названий; сортировать же одну открытую страницу на клиенте значит
                    упорядочить 20 строк из двухсот. */}
                <TableHead className={HIDE.city}>{t('city')}</TableHead>
                <TableHead
                  sortKey="createdAt"
                  sort={sort}
                  onSort={sortBy}
                  className={HIDE.createdAt}
                >
                  {t('createdAt')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={sortBy}>
                  {t('status')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {universities.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((u) => (
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
          <TablePagination
            page={page}
            total={total}
            limit={limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            // Новый размер страницы — снова с первой: «страницы 10» при 200 строках
            // на странице может уже не быть.
            onLimitChange={(n) => refilter(() => setLimit(n))}
          />
        </Card>
      )}
    </div>
  )
}
