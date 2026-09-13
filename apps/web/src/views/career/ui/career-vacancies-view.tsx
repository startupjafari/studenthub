'use client'

import { ADMIN_PAGE_SIZES } from '@studenthub/shared-schemas'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Briefcase, Search } from 'lucide-react'
import {
  EMPLOYMENT_TYPES,
  WORK_FORMATS,
  type EmploymentType,
  type VacancySort,
  type WorkFormat,
} from '@studenthub/shared-schemas'
import { searchVacancies, vacancyKeys, type Vacancy } from '../../../entities/vacancy'
import {
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
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useSortState,
} from '../../../shared/ui'
import {
  CareerUniversityRequired,
  useCareerUniversity,
} from '../../../features/career-university-scope'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Витрина вакансий для студента.
 *
 * Процент совпадения показывается, но НИЧЕГО не скрывает: он влияет только на то, что
 * студент видит первым, а не на состав списка. Спрятать вакансию из-за низкого процента
 * значило бы принять решение за человека на основании неполных данных.
 */
// Ширины колонок: должность и компания — главное, формат и город сжимаются первыми.
// Размеры страницы — общий для админских экранов набор из контракта.
const PAGE_SIZES = ADMIN_PAGE_SIZES

const COLS = ['30%', '20%', '20%', '12%', '10%', '8%'] as const

export function CareerVacanciesView() {
  const t = useTranslations('Vacancies')
  const locale = useLocale()
  const tErr = useTranslations('Errors')
  const [search, setSearch] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType | null>(null)
  const [workFormat, setWorkFormat] = useState<WorkFormat | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  // Витрина показывает вакансии, одобренные конкретным вузом: у сотрудника он в токене,
  // платформенная роль выбирает его в шапке.
  const { needsPick, universityId } = useCareerUniversity()
  const { sort, toggle } = useSortState()
  const params = {
    page,
    limit,
    ...(search ? { search } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(workFormat ? { workFormat } : {}),
    ...(universityId ? { universityId } : {}),
    ...(sort ? { sort: sort.key as VacancySort, order: sort.dir } : {}),
  }

  const query = useQuery({
    queryKey: vacancyKeys.search(params),
    queryFn: () => searchVacancies(params),
    enabled: !needsPick || !!universityId,
    // Прошлая страница остаётся на экране, пока грузится новая.
    placeholderData: keepPreviousData,
  })

  const employmentLabel: Record<EmploymentType, string> = {
    INTERNSHIP: t('employmentInternship'),
    PART_TIME: t('employmentPartTime'),
    FULL_TIME: t('employmentFullTime'),
    CONTRACT: t('employmentContract'),
    FREELANCE: t('employmentFreelance'),
  }
  const formatLabel: Record<WorkFormat, string> = {
    ONSITE: t('formatOnsite'),
    HYBRID: t('formatHybrid'),
    REMOTE: t('formatRemote'),
  }

  const rows = query.data?.items ?? []

  // Новый фильтр или размер страницы — снова с первой: на прежней странице
  // отфильтрованного списка может не быть строк вовсе.
  const sortBy = (key: string): void => refilter(() => toggle(key))

  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            {/* Поиск — первым: он сужает выборку сильнее любого фильтра, а на телефоне
                переносится в шапке вместе с остальными элементами правой зоны. */}
            <div className="relative w-full sm:w-56">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              {/* Высота — из размерной шкалы (§9), а не своим классом: поле и два
                  селекта в одной строке шапки обязаны совпадать по высоте. */}
              <Input
                size="md"
                value={search}
                onChange={(e) => refilter(() => setSearch(e.target.value))}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="pl-9"
              />
            </div>

            {/* Два ряда чипов (8 кнопок) занимали полосу под шапкой и не говорили,
                что «ничего не нажато» — это тоже состояние. У селекта оно названо. */}
            <Select
              value={employmentType ?? 'all'}
              onValueChange={(v) =>
                refilter(() => setEmploymentType(v === 'all' ? null : (v as EmploymentType)))
              }
            >
              <SelectTrigger size="md" className="w-40" aria-label={t('employmentAll')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('employmentAll')}</SelectItem>
                {EMPLOYMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {employmentLabel[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={workFormat ?? 'all'}
              onValueChange={(v) =>
                refilter(() => setWorkFormat(v === 'all' ? null : (v as WorkFormat)))
              }
            >
              <SelectTrigger size="md" className="w-36" aria-label={t('formatAll')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('formatAll')}</SelectItem>
                {WORK_FORMATS.map((format) => (
                  <SelectItem key={format} value={format}>
                    {formatLabel[format]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {needsPick && !universityId ? (
        <CareerUniversityRequired />
      ) : query.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr(toApiError(query.error).code)} description={tErr('retryHint')} />
      ) : rows.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={<Briefcase className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={COLS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colTitle')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('colCompany')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('colFormat')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('colCity')}</TableHead>
                  <TableHead numeric sortKey="salary" sort={sort} onSort={sortBy}>
                    {t('colSalary')}
                  </TableHead>
                  <TableHead numeric>{t('match')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && <TableSkeletonRows columns={6} />}
                {rows.map((vacancy) => {
                  const salary = salaryText(
                    vacancy,
                    { from: t('salaryFrom'), to: t('salaryTo') },
                    locale,
                  )
                  return (
                    <TableRow key={vacancy.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <TableText value={vacancy.title} />
                        {vacancy.skills.length > 0 && (
                          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                            {vacancy.skills.join(' · ')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        <TableText value={vacancy.company.name} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {employmentLabel[vacancy.employmentType]} ·{' '}
                        {formatLabel[vacancy.workFormat]}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        <TableText value={vacancy.city} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <TableText value={salary} />
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Процент совпадения есть только у студента с карьерным профилем —
                            у сотрудника вуза колонка пустая, а не нулевая. */}
                        {vacancy.match ? (
                          <span
                            className={cn(
                              'font-semibold tabular-nums',
                              vacancy.match.score >= 70 ? 'text-primary' : 'text-muted-foreground',
                            )}
                          >
                            {vacancy.match.score}%
                          </span>
                        ) : (
                          <TableText value={null} />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              limit={limit}
              total={query.data?.total ?? 0}
              onPageChange={setPage}
              limitOptions={PAGE_SIZES}
              onLimitChange={(n) => refilter(() => setLimit(n))}
            />
          </Card>
        </>
      )}
    </div>
  )
}

function salaryText(
  vacancy: Vacancy,
  labels: { from: string; to: string },
  locale: string,
): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency: currency } = vacancy
  if (min == null && max == null) return null
  const unit = currency ?? ''
  const fmt = (n: number) => n.toLocaleString(locale)
  if (min != null && max != null) return `${fmt(min)} — ${fmt(max)} ${unit}`.trim()
  if (min != null) return `${labels.from} ${fmt(min)} ${unit}`.trim()
  return `${labels.to} ${fmt(max as number)} ${unit}`.trim()
}
