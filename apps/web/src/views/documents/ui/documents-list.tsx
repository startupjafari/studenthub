'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { FilterX, FolderLock, Lock, Paperclip, Plus, Search, SearchX, Users } from 'lucide-react'
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUSES } from '@studenthub/shared-config'
import type { DocumentSortValue } from '@studenthub/shared-schemas'
import { documentKeys, fetchDocuments } from '../../../entities/document'
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
  TableRow,
  TableSkeletonRows,
  TableText,
  useSortState,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { DocumentActions } from './document-actions'
import { UploadWizard } from './upload-wizard'

export type DocumentsPreset = 'active' | 'archived' | 'shared' | 'issued'

// Тон бейджа статуса.
const STATUS_TONE: Record<string, 'secondary' | 'info' | 'success' | 'outline'> = {
  DRAFT: 'secondary',
  UPLOADED: 'info',
  IN_REVIEW: 'info',
  VERIFIED: 'success',
  ACCEPTED: 'success',
  REJECTED: 'outline',
  NEEDS_REPLACEMENT: 'outline',
  EXPIRING: 'outline',
  EXPIRED: 'outline',
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
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus] = useState<string>(initialStatus ?? 'all')
  const [uploading, setUploading] = useState(false)

  // Сортировка серверная: упорядочена вся выборка, а не открытая страница. Пресет
  // раздела тоже уходит на сервер — иначе счётчик строк и содержимое расходились.
  const { sort, toggle } = useSortState()
  const query = {
    view: preset === 'archived' ? ('archived' as const) : ('active' as const),
    ...(preset === 'shared' || preset === 'issued' ? { preset } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(category !== 'all' ? { category: category as 'PERSONAL' } : {}),
    ...(status !== 'all' ? { status: status as 'DRAFT' } : {}),
    ...(sort ? { sort: sort.key as DocumentSortValue, order: sort.dir } : {}),
  }
  const q = useQuery({ queryKey: documentKeys.list(query), queryFn: () => fetchDocuments(query) })
  const docs = q.data ?? []

  const rows = docs

  const filtered = search.trim() !== '' || category !== 'all' || status !== 'all'
  function resetFilters(): void {
    setSearch('')
    setCategory('all')
    setStatus('all')
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
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
        <Select value={status} onValueChange={setStatus}>
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
          {!q.isLoading && !q.isError && rows.length > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {t('found', { n: rows.length })}
            </span>
          )}
          {uploadButton}
        </div>
      </div>

      {uploading && <UploadWizard onClose={() => setUploading(false)} />}

      {q.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !q.isLoading && rows.length === 0 ? (
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
                <TableHead sortKey="title" sort={sort} onSort={toggle}>
                  {t('fieldTitle')}
                </TableHead>
                <TableHead sortKey="category" sort={sort} onSort={toggle} className={HIDE.category}>
                  {t('category')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle}>
                  {t('status')}
                </TableHead>
                {/* Номер не сортируется: наружу уходит только маска ******4821,
                    порядок по ней ничего не значит. */}
                <TableHead className={HIDE.number}>{t('fieldNumber')}</TableHead>
                <TableHead sortKey="issuedAt" sort={sort} onSort={toggle} className={HIDE.issuedAt}>
                  {t('fieldIssuedAt')}
                </TableHead>
                <TableHead sortKey="expiresAt" sort={sort} onSort={toggle}>
                  {t('fieldExpiresAt')}
                </TableHead>
                <TableHead sortKey="access" sort={sort} onSort={toggle} className={HIDE.access}>
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
                      <TableText value={t(`docType_${doc.type}`)} />
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
        </Card>
      )}
    </div>
  )
}
