'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BookOpen,
  Building2,
  CheckCircle2,
  GraduationCap,
  Layers,
  Search,
  Users,
} from 'lucide-react'
import {
  fetchUniversities,
  fetchUniversityStats,
  universityKeys,
  type University,
  type UniversityStats,
} from '../../../entities/university'
import { useKatoNames } from '../../../entities/kato'
import {
  Card,
  CardContent,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Ширины: вуз · статус · факультеты · группы · аудитории · студенты · преподаватели · всего людей.
const COLS = ['24%', '12%', '10%', '10%', '10%', '11%', '13%', '10%'] as const
// Узкий экран: доли пересчитаны на колонки, которые остаются видимыми (остальные скрыты
// классами HIDE). Без этого им доставалось по 30–40px и заголовок обрезался в многоточие.
// Остаются вуз, статус и три счётчика людей.
const COLS_NARROW = ['44%', '0', '0', '0', '0', '28%', '0', '28%'] as const
const HIDE = {
  // На телефоне остаются название вуза, студенты и «людей всего»: пять колонок ужимают
  // заголовки до «С..» и «Пр…», и по такой шапке не понять, какое число к чему относится.
  status: 'hidden md:table-cell',
  faculties: 'hidden md:table-cell',
  groups: 'hidden md:table-cell',
  rooms: 'hidden xl:table-cell',
  teachers: 'hidden md:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон обязан прятать те же колонки, что и шапка,
// иначе во время загрузки в строке ячеек больше, чем в шапке, и колонки разъезжаются.
const SKELETON_COLS = [
  undefined,
  HIDE.status,
  HIDE.faculties,
  HIDE.groups,
  HIDE.rooms,
  undefined,
  HIDE.teachers,
  undefined,
]

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'text-warning',
  ACTIVE: 'text-success',
  BLOCKED: 'text-destructive',
}

interface Row extends University {
  stats: UniversityStats | null
  people: number | null
}

// Статистика платформы: сводка по всем вузам сверху и таблица сравнения ниже —
// раскладка та же, что у остальных экранов админа платформы (шапка → карточка с таблицей).
export function PlatformStatsView() {
  const t = useTranslations('Stats')
  const tUni = useTranslations('Universities')
  const tErr = useTranslations('Errors')
  const [search, setSearch] = useState('')

  const unis = useQuery({ queryKey: universityKeys.list(), queryFn: fetchUniversities })
  const list = useMemo(() => unis.data ?? [], [unis.data])

  // Счётчики по вузу отдаёт отдельный эндпоинт (кэш 5 мин на сервере) — тянем их
  // параллельно одним хуком, а не по карточке, чтобы собрать общую таблицу и итоги.
  const statsQueries = useQueries({
    queries: list.map((u) => ({
      queryKey: universityKeys.stats(u.id),
      queryFn: () => fetchUniversityStats(u.id),
    })),
  })
  const statsLoading = statsQueries.some((q) => q.isLoading)

  // Вузов на платформе десятки, не тысячи — сборку строк не мемоизируем.
  const rows: Row[] = list.map((u, i) => {
    const stats = statsQueries[i]?.data ?? null
    return { ...u, stats, people: stats ? stats.students + stats.teachers : null }
  })

  const totals = rows.reduce(
    (acc, r) => ({
      faculties: acc.faculties + (r.stats?.faculties ?? 0),
      groups: acc.groups + (r.stats?.groups ?? 0),
      rooms: acc.rooms + (r.stats?.rooms ?? 0),
      students: acc.students + (r.stats?.students ?? 0),
      teachers: acc.teachers + (r.stats?.teachers ?? 0),
      active: acc.active + (r.status === 'ACTIVE' ? 1 : 0),
    }),
    { faculties: 0, groups: 0, rooms: 0, students: 0, teachers: 0, active: 0 },
  )

  // `city` хранит код КАТО, поэтому и поиск, и подпись под названием идут по
  // резолвнутому имени: иначе фильтр «Алматы» не нашёл бы вуз с городом «750000000».
  const { nameOf: cityName } = useKatoNames(rows.map((r) => r.city))

  const q = search.trim().toLowerCase()
  const filtered = q
    ? rows.filter((r) =>
        [r.name, r.shortName, cityName(r.city)].some((v) => v?.toLowerCase().includes(q)),
      )
    : rows

  const cellValue = useCallback(
    (row: Row, key: string): unknown => {
      switch (key) {
        case 'name':
          return row.name
        case 'status':
          return tUni(`status${row.status}`)
        case 'faculties':
          return row.stats?.faculties ?? null
        case 'groups':
          return row.stats?.groups ?? null
        case 'rooms':
          return row.stats?.rooms ?? null
        case 'students':
          return row.stats?.students ?? null
        case 'teachers':
          return row.stats?.teachers ?? null
        case 'people':
          return row.people
        default:
          return null
      }
    },
    [tUni],
  )
  // Сортировка клиентская намеренно: строки собираются на клиенте из GET /universities
  // и отдельного запроса статистики по каждому вузу. Серверного списка с этими числами
  // не существует — сортировать по «студентам» было бы нечему.
  const { rows: sorted, sort, toggle } = useTableSort(filtered, cellValue)

  const tiles = [
    { key: 'universities', value: list.length, label: t('universities'), icon: Building2 },
    { key: 'active', value: totals.active, label: t('activeUniversities'), icon: CheckCircle2 },
    { key: 'faculties', value: totals.faculties, label: t('faculties'), icon: Layers },
    { key: 'groups', value: totals.groups, label: t('groups'), icon: Users },
    { key: 'students', value: totals.students, label: t('students'), icon: GraduationCap },
    { key: 'teachers', value: totals.teachers, label: t('teachers'), icon: BookOpen },
  ]

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      {/* Поиск — в шапке, как на остальных экранах платформы (DESIGN_SYSTEM §10.1). */}
      <PageHeader
        title={t('platformTitle')}
        subtitle={t('platformSubtitle')}
        actions={
          <div className="relative w-40 sm:w-56">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchUniversity')}
              className="h-9 pl-9 text-sm"
            />
          </div>
        }
      />

      {/* Итоги по платформе: сумма того, что ниже разложено по вузам.
          Плитка горизонтальная (иконка слева, число и подпись справа), а не стопкой:
          при вертикальной раскладке карточка выходила ~135px и итоги вытесняли таблицу
          с экрана. Отступы задаёт только Card — `p-4` на CardContent добавлял вторые
          сверху и снизу поверх собственного `py` карточки. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Card key={tile.key} size="sm">
              <CardContent className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-current/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  {/* Числа — главное на плитке, поэтому крупнее подписи и с tabular-nums:
                      колонка цифр не «дышит» при обновлении данных. */}
                  <span className="block text-xl leading-tight font-semibold tabular-nums">
                    {unis.isLoading || statsLoading ? (
                      <Skeleton className="h-5 w-10" />
                    ) : (
                      tile.value
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{tile.label}</span>
                </span>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {unis.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !unis.isLoading && sorted.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" aria-hidden />}
          title={q ? t('nothingFound') : t('noUniversities')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={toggle}>
                  {tUni('name')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle} className={HIDE.status}>
                  {t('status')}
                </TableHead>
                <TableHead
                  numeric
                  sortKey="faculties"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.faculties}
                >
                  {t('faculties')}
                </TableHead>
                <TableHead
                  numeric
                  sortKey="groups"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.groups}
                >
                  {t('groups')}
                </TableHead>
                <TableHead
                  numeric
                  sortKey="rooms"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.rooms}
                >
                  {t('rooms')}
                </TableHead>
                <TableHead numeric sortKey="students" sort={sort} onSort={toggle}>
                  {t('students')}
                </TableHead>
                <TableHead
                  numeric
                  sortKey="teachers"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.teachers}
                >
                  {t('teachers')}
                </TableHead>
                <TableHead numeric sortKey="people" sort={sort} onSort={toggle}>
                  {t('people')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unis.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {sorted.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <TableText value={row.name} />
                    {(row.city || row.shortName) && (
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {cityName(row.city) ?? row.shortName}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={cn('text-sm', HIDE.status, STATUS_STYLE[row.status])}>
                    <TableText value={tUni(`status${row.status}`)} />
                  </TableCell>
                  <Num value={row.stats?.faculties} className={HIDE.faculties} />
                  <Num value={row.stats?.groups} className={HIDE.groups} />
                  <Num value={row.stats?.rooms} className={HIDE.rooms} />
                  <Num value={row.stats?.students} />
                  <Num value={row.stats?.teachers} className={HIDE.teachers} />
                  <Num value={row.people ?? undefined} className="font-semibold" />
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* Итоговая строка: сравнение вузов без общей суммы читается наполовину. */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm text-muted-foreground">
            <span>{t('universitiesCount', { n: sorted.length })}</span>
            <span className="tabular-nums">
              {t('totalPeople', { n: totals.students + totals.teachers })}
            </span>
          </div>
        </Card>
      )}
    </div>
  )
}

// Числовая ячейка: пока счётчики вуза грузятся — скелетон вместо прыжка нулей.
function Num({ value, className }: { value?: number; className?: string }) {
  return (
    <TableCell className={cn('text-right tabular-nums', className)}>
      {value === undefined ? <Skeleton className="ml-auto h-4 w-8" /> : value}
    </TableCell>
  )
}
