'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { FilterX, FolderLock, Lock, Paperclip, Plus, Search, SearchX, Users } from 'lucide-react'
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUSES } from '@studenthub/shared-config'
import type { DocumentSortValue } from '@studenthub/shared-schemas'
import { documentKeys, fetchDocumentsPage } from '../../../entities/document'
import { useDocumentTypeCatalog } from '../../../entities/document-type'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
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
  usePagedSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { DocumentActions } from './document-actions'
import { UploadWizard } from './upload-wizard'

export type DocumentsPreset = 'active' | 'archived' | 'shared' | 'issued'

// Тон бейджа статуса. Статусы проверки (15.3) теперь реально выставляются: «требует
// замены» и «отклонён» ждут действия владельца — красным, близкий срок — предупреждением.
const STATUS_TONE: Record<
  string,
  'secondary' | 'info' | 'success' | 'outline' | 'warning' | 'destructive'
> = {
  DRAFT: 'secondary',
  UPLOADED: 'outline',
  IN_REVIEW: 'info',
  VERIFIED: 'success',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
  NEEDS_REPLACEMENT: 'destructive',
  EXPIRING: 'warning',
  EXPIRED: 'destructive',
  ARCHIVED: 'secondary',
}

// Ширины колонок: название · категория · статус · номер · выдан · действует до · доступ · «…».
const COLS = ['26%', '13%', '13%', '13%', '11%', '12%', '9%', '3.5rem'] as const
// На узком экране остаются только те колонки, без которых список не читается: название,
// статус, срок действия и меню. Классы общие для шапки, строк и скелетона — иначе на
// планшете шапка и строки расходятся по числу колонок.
const HIDE = {
  category: 'hidden lg:table-cell',
  number: 'hidden xl:table-cell',
  issuedAt: 'hidden md:table-cell',
  access: 'hidden lg:table-cell',
} as const
// Порог «скоро истекает» — тот же, что у плитки «Скоро истекает» в обзоре.
const EXPIRING_DAYS = 30
// Размер страницы — как у журнала документов; предел серверной схемы — 100.
const PAGE_SIZES = [20, 50, 100] as const

// Порядок и классы скрытия колонок — те же, что у строк с данными: на время загрузки
// геометрия таблицы не меняется.
const DOC_SKELETON_COLS = [
  undefined,
  HIDE.category,
  undefined,
  HIDE.number,
  HIDE.issuedAt,
  undefined,
  HIDE.access,
  undefined,
]

export function DocumentsList({
  preset,
  initialStatus,
}: {
  preset: DocumentsPreset
  /** Статус, выбранный за пределами списка (переход из «Обзора»). */
  initialStatus?: string
}) {
  const t = useTranslations('Documents')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  // Название собственного типа вуза задаёт вуз — в словаре его нет.
  const { labelOf } = useDocumentTypeCatalog()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus] = useState<string>(initialStatus ?? 'all')
  const [uploading, setUploading] = useState(false)

  // Сортировка и страницы серверные: упорядочена и поделена на страницы вся выборка, а не
  // загруженная часть. Пресет раздела тоже уходит на сервер — иначе счётчик строк и
  // содержимое расходились. Прежняя страница остаётся на экране, пока грузится следующая.
  const paged = usePagedSort<DocumentSortValue>(PAGE_SIZES[0])
  const query = {
    view: preset === 'archived' ? ('archived' as const) : ('active' as const),
    ...(preset === 'shared' || preset === 'issued' ? { preset } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(category !== 'all' ? { category: category as 'PERSONAL' } : {}),
    ...(status !== 'all' ? { status: status as 'DRAFT' } : {}),
    ...paged.query,
  }
  const q = useQuery({
    queryKey: documentKeys.list(query),
    queryFn: () => fetchDocumentsPage(query),
    placeholderData: keepPreviousData,
  })
  const rows = q.data?.items ?? []
  const total = q.data?.total ?? 0

  // Фильтр меняет выборку — листать её начинают с первой страницы: на пятой странице
  // нового, короткого списка может не оказаться ничего.
  function refilter(apply: () => void): void {
    apply()
    paged.setPage(1)
  }
  const filtered = search.trim() !== '' || category !== 'all' || status !== 'all'
  function resetFilters(): void {
    refilter(() => {
      setSearch('')
      setCategory('all')
      setStatus('all')
    })
  }

  const emptyKey =
    preset === 'archived'
      ? 'emptyArchive'
      : preset === 'shared'
        ? 'emptyShared'
        : preset === 'issued'
          ? 'emptyIssued'
          : 'emptyActive'

  const uploadButton =
    preset === 'active' ? (
      <Button type="button" size="md" onClick={() => setUploading(true)}>
        <Plus className="size-4" aria-hidden /> {t('upload')}
      </Button>
    ) : null

  // Даты нет — в ячейке слово «пусто» (`TableEmpty`), а не прочерк.
  const fmt = (iso: string | null): string | null =>
    iso ? new Date(iso).toLocaleDateString(locale) : null

  // Срок действия — единственное поле, где важен не факт, а близость даты: истёкший
  // документ красим как ошибку, ближайший месяц — предупреждением.
  function expiryTone(iso: string | null): string {
    if (!iso) return 'text-muted-foreground'
    const days = (new Date(iso).getTime() - Date.now()) / 86_400_000
    if (days < 0) return 'text-destructive'
    if (days <= EXPIRING_DAYS) return 'text-warning'
    return ''
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Панель управления списком: слева — поиск и фильтры (что показать), справа —
          счётчик и действие (что сделать). Сортировка живёт в заголовках таблицы,
          поэтому в панели её нет. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => refilter(() => setSearch(e.target.value))}
            placeholder={t('search')}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Select value={category} onValueChange={(v) => refilter(() => setCategory(v))}>
          <SelectTrigger aria-label={t('category')} size="md" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allCategories')}</SelectItem>
            {DOCUMENT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`docCat_${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => refilter(() => setStatus(v))}>
          <SelectTrigger aria-label={t('status')} size="md" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses')}</SelectItem>
            {DOCUMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`docStatus_${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Кнопка сброса появляется только когда есть что сбрасывать — иначе она просто
            занимает место в панели. */}
        {filtered && (
          <Button type="button" variant="ghost" size="md" onClick={resetFilters}>
            <FilterX className="size-4" aria-hidden /> {t('filtersReset')}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {!q.isLoading && !q.isError && total > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {t('found', { n: total })}
            </span>
          )}
          {uploadButton}
        </div>
      </div>

      {uploading && <UploadWizard onClose={() => setUploading(false)} />}

      {q.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !q.isLoading && total === 0 ? (
        // Пусто по фильтру и пусто вообще — разные ситуации: в первой выход
        // из положения — сброс фильтров, во второй — загрузить документ.
        filtered ? (
          <EmptyState
            icon={<SearchX className="size-6" aria-hidden />}
            title={t('nothingFound')}
            description={t('nothingFoundDesc')}
            action={
              <Button type="button" variant="outline" onClick={resetFilters}>
                <FilterX className="size-4" aria-hidden /> {t('filtersReset')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FolderLock className="size-6" aria-hidden />}
            title={t(emptyKey)}
            description={t(`${emptyKey}Desc`)}
            action={
              preset === 'active' ? (
                <Button type="button" onClick={() => setUploading(true)}>
                  <Plus className="size-4" aria-hidden /> {t('upload')}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        // Загрузка идёт скелетоном в строках: шапка и ширины колонок остаются на месте,
        // таблица не подменяется серым блоком.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="title" sort={paged.sort} onSort={paged.toggle}>
                  {t('fieldTitle')}
                </TableHead>
                <TableHead
                  sortKey="category"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.category}
                >
                  {t('category')}
                </TableHead>
                <TableHead sortKey="status" sort={paged.sort} onSort={paged.toggle}>
                  {t('status')}
                </TableHead>
                {/* Номер не сортируется: наружу уходит только маска ******4821,
                    порядок по ней ничего не значит. */}
                <TableHead className={HIDE.number}>{t('fieldNumber')}</TableHead>
                <TableHead
                  sortKey="issuedAt"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.issuedAt}
                >
                  {t('fieldIssuedAt')}
                </TableHead>
                <TableHead sortKey="expiresAt" sort={paged.sort} onSort={paged.toggle}>
                  {t('fieldExpiresAt')}
                </TableHead>
                <TableHead
                  sortKey="access"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.access}
                >
                  {t('colAccess')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <TableSkeletonRows columns={DOC_SKELETON_COLS} />}
              {rows.map((doc) => (
                <TableRow key={doc.id} className="hover:bg-muted/40">
                  <TableCell>
                    {/* Скрепка стоит сразу за названием, а не улетает к правому краю
                        колонки: это часть строки названия, а не отдельная колонка. */}
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 font-medium">
                        <TableText value={doc.title} />
                      </span>
                      {doc.fileCount > 0 && (
                        <span
                          className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums"
                          title={t('fieldFilesCount', { n: doc.fileCount })}
                        >
                          <Paperclip className="size-3.5" aria-hidden />
                          {doc.fileCount}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      <TableText value={labelOf(doc.type)} />
                    </span>
                  </TableCell>
                  <TableCell className={cn(HIDE.category, 'text-muted-foreground')}>
                    <TableText value={t(`docCat_${doc.category}`)} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[doc.status] ?? 'secondary'}>
                      {t(`docStatus_${doc.status}`)}
                    </Badge>
                    {doc.rejectionReason && (
                      <span className="block text-xs text-destructive">
                        <TableText value={doc.rejectionReason} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(HIDE.number, 'font-mono text-muted-foreground tabular-nums')}
                  >
                    <TableText value={doc.numberMasked} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      HIDE.issuedAt,
                      'whitespace-nowrap text-muted-foreground tabular-nums',
                    )}
                  >
                    {fmt(doc.issuedAt) ?? <TableEmpty />}
                  </TableCell>
                  <TableCell
                    className={cn('whitespace-nowrap tabular-nums', expiryTone(doc.expiresAt))}
                  >
                    {fmt(doc.expiresAt) ?? <TableEmpty />}
                  </TableCell>
                  <TableCell className={cn(HIDE.access, 'text-muted-foreground')}>
                    <span
                      className="flex items-center gap-1.5"
                      title={
                        doc.accessCount > 0
                          ? t('sharedWith', { count: doc.accessCount })
                          : t('onlyMe')
                      }
                    >
                      {doc.accessCount > 0 ? (
                        <Users className="size-3.5 shrink-0" aria-hidden />
                      ) : (
                        <Lock className="size-3.5 shrink-0" aria-hidden />
                      )}
                      <span className="truncate text-xs">
                        {doc.accessCount > 0 ? doc.accessCount : t('onlyMe')}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DocumentActions doc={doc} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={paged.page}
            total={total}
            limit={paged.limit}
            onPageChange={paged.setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={paged.setLimit}
          />
        </Card>
      )}
    </div>
  )
}
