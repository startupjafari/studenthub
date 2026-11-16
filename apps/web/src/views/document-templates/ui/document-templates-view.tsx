'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { FileText, FilterX, Plus, Search } from 'lucide-react'
import {
  DOCUMENT_TEMPLATE_CATEGORY_VALUES,
  DOCUMENT_TEMPLATE_STATUS_VALUES,
  type DocumentTemplateCategory,
  type DocumentTemplateStatus,
} from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SegmentedTabs,
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
} from '../../../shared/ui'
import { afterOverlayClose } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  documentTemplateKeys,
  fetchDocumentTemplates,
  type DocumentTemplateListParams,
} from '../../../entities/document-template'
import { StatusBadge } from './status-badge'
import { TemplateWizard } from './template-wizard'
import { VariableCatalog } from './variable-catalog'

export const TEMPLATES_BASE = '/university-admin/document-templates'

type Tab = 'templates' | 'variables'
const PAGE_SIZE = 20
const DEBOUNCE_MS = 300
// Название · вид · статус · переменные · автор · создан · изменён. Даты числом
// (06.11.2026): «6 нояб. 2026 г.» в колонке такой ширины переносилось на две строки.
const COLS = ['23%', '15%', '14%', '13%', '11%', '12%', '12%'] as const
const COLS_NARROW = ['56%', '0', '44%', '0', '0', '0', '0'] as const
const HIDE = {
  category: 'hidden md:table-cell',
  variables: 'hidden lg:table-cell',
  author: 'hidden xl:table-cell',
  created: 'hidden xl:table-cell',
  updated: 'hidden md:table-cell',
} as const
const SKELETON_COLS = [
  undefined,
  HIDE.category,
  undefined,
  HIDE.variables,
  HIDE.author,
  HIDE.created,
  HIDE.updated,
]

// «Документы → Шаблоны» у админа вуза (docs/PROJECT.md §3.8 «Шаблоны документов»): свои
// DOCX-бланки вуза с переменными StudentHub и каталог этих переменных.
export function DocumentTemplatesView() {
  const t = useTranslations('DocumentTemplates')
  const format = useFormatter()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('templates')
  const [wizard, setWizard] = useState(false)

  const [search, setSearch] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'all' | DocumentTemplateStatus>('all')
  const [category, setCategory] = useState<'all' | DocumentTemplateCategory>('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const next = search.trim().slice(0, 100)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced])

  const params: DocumentTemplateListParams = {
    page,
    limit: PAGE_SIZE,
    ...(debounced ? { search: debounced } : {}),
    ...(status !== 'all' ? { status } : {}),
    ...(category !== 'all' ? { category } : {}),
  }
  const list = useQuery({
    queryKey: documentTemplateKeys.list(params),
    queryFn: () => fetchDocumentTemplates(params),
    placeholderData: keepPreviousData,
    enabled: tab === 'templates',
  })
  const items = list.data?.items ?? []
  const narrowed = status !== 'all' || category !== 'all'
  const filtered = !!debounced || narrowed
  const resetFilters = () => {
    setStatus('all')
    setCategory('all')
    setPage(1)
  }

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: '2-digit', month: '2-digit', year: 'numeric' })

  const create = (
    <Button size="md" onClick={() => setWizard(true)}>
      <Plus className="size-4" aria-hidden /> {t('create')}
    </Button>
  )

  // Поиск — в шапке, как у остальных списков (DESIGN_SYSTEM §10.1). У каждой вкладки свой:
  // по шаблонам ищет сервер, по каталогу — сам каталог.
  const searchField =
    tab === 'templates' ? (
      <SearchField value={search} onChange={setSearch} placeholder={t('searchPlaceholder')} />
    ) : (
      <SearchField
        value={catalogQuery}
        onChange={setCatalogQuery}
        placeholder={t('catalogSearch')}
      />
    )

  return (
    // Высоту области отдаём только таблице (она прокручивается внутри карточки). Каталог —
    // обычный поток: с `min-h-0` он вылезал за блок, и нижний отступ страницы оставался
    // под блоком, а последние карточки прилипали к краю.
    <div className={cn('flex w-full flex-1 flex-col gap-4', tab === 'templates' && 'min-h-0')}>
      <PageHeader
        title={t('title')}
        subtitle={tab === 'templates' ? t('subtitle') : t('catalogSubtitle')}
        tabs={
          <SegmentedTabs
            items={[
              { value: 'templates' as const, label: t('tabTemplates') },
              { value: 'variables' as const, label: t('tabVariables') },
            ]}
            value={tab}
            onChange={setTab}
            aria-label={t('sections')}
          />
        }
        actions={
          <>
            {searchField}
            {create}
          </>
        }
      />

      {tab === 'variables' ? (
        <VariableCatalog query={catalogQuery} />
      ) : (
        <>
          {/* Два фильтра в шапку вместе с вкладками, поиском и кнопкой не помещаются — она
              переносилась на вторую строку. Они идут строкой над таблицей, как в журнале
              документов, той же высоты, что контролы шапки. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as typeof status)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label={t('colStatus')} size="md" className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filterAllStatuses')}</SelectItem>
                {DOCUMENT_TEMPLATE_STATUS_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status_${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v as typeof category)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label={t('colCategory')} size="md" className="sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filterAllCategories')}</SelectItem>
                {DOCUMENT_TEMPLATE_CATEGORY_VALUES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`category_${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {narrowed && (
              <Button variant="ghost" size="md" onClick={resetFilters}>
                <FilterX className="size-4" aria-hidden /> {t('resetFilters')}
              </Button>
            )}
          </div>

          {list.isError ? (
            <EmptyState
              title={t('loadError')}
              action={<Button onClick={() => void list.refetch()}>{t('retry')}</Button>}
            />
          ) : !list.isPending && items.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-8" aria-hidden />}
              title={filtered ? t('emptyFiltered') : t('emptyTitle')}
              description={filtered ? undefined : t('emptyDescription')}
              action={filtered ? undefined : create}
            />
          ) : (
            <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
              <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colTitle')}</TableHead>
                    <TableHead className={HIDE.category}>{t('colCategory')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead numeric className={HIDE.variables}>
                      {t('colVariables')}
                    </TableHead>
                    <TableHead className={HIDE.author}>{t('colAuthor')}</TableHead>
                    <TableHead className={HIDE.created}>{t('colCreated')}</TableHead>
                    <TableHead className={HIDE.updated}>{t('colUpdated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
                  {items.map((row) => (
                    <TableRow key={row.id} className="hover:bg-muted/40">
                      <TableCell>
                        <Link
                          href={`${TEMPLATES_BASE}/${row.id}`}
                          className="block min-w-0 font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                        >
                          <TableText value={row.title} />
                        </Link>
                        {row.description && (
                          <span className="block text-xs text-muted-foreground">
                            <TableText value={row.description} />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className={cn(HIDE.category, 'text-muted-foreground')}>
                        <TableText value={t(`category_${row.category}`)} />
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={row.status} />
                          {row.hasUnpublishedChanges && (
                            <Badge variant="info" title={t('unpublishedChangesHint')}>
                              {t('unpublishedChanges')}
                            </Badge>
                          )}
                          {row.currentVersion && !row.currentVersion.valid && (
                            <Badge variant="destructive">{t('needsFix')}</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className={cn(HIDE.variables, 'text-right tabular-nums')}>
                        {row.variableCount}
                      </TableCell>
                      <TableCell className={cn(HIDE.author, 'text-muted-foreground')}>
                        <TableText value={row.author?.name ?? null} />
                      </TableCell>
                      <TableCell className={cn(HIDE.created, 'text-sm tabular-nums')}>
                        <time dateTime={row.createdAt}>{date(row.createdAt)}</time>
                      </TableCell>
                      <TableCell className={cn(HIDE.updated, 'text-sm tabular-nums')}>
                        <time dateTime={row.updatedAt}>{date(row.updatedAt)}</time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={page}
                total={list.data?.total ?? 0}
                limit={PAGE_SIZE}
                onPageChange={setPage}
              />
            </Card>
          )}
        </>
      )}

      {wizard && (
        <TemplateWizard
          onClose={(id) => {
            setWizard(false)
            // В карточку — после того, как окно снимет свою запись истории, иначе адрес
            // откатится обратно на список.
            if (id) afterOverlayClose(() => router.push(`${TEMPLATES_BASE}/${id}`))
          }}
        />
      )}
    </div>
  )
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative w-full sm:w-48">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        size="md"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9"
      />
    </div>
  )
}
