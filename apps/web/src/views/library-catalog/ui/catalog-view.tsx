'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BookOpen, FileUp, Plus, PowerOff, Search } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Label,
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
  usePagedSort,
} from '../../../shared/ui'
import { cn, toApiError } from '../../../shared/lib'
import {
  BookCover,
  fetchBookSections,
  fetchBooks,
  libraryKeys,
  type BookCard,
  type BookListParams,
} from '../../../entities/library'
import { BookFormModal } from './book-form-modal'
import { LibraryImportModal } from './library-import-modal'

// Каталог библиотеки (Фаза 20, docs/PROJECT.md §3.11). Два режима одного экрана:
//   staff  — библиотекарь и админ вуза: заведение книг, импорт, архив;
//   reader — студент и староста: поиск, наличие, переход к брони.
// Список — таблицей: фонд вуза — тысячи книг, их листают и упорядочивают. Страница и
// порядок считаются на сервере (`usePagedSort`): сортировка в браузере переставляла бы
// только открытую страницу.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250
const ALL_SECTIONS = '__all__'

type BookSort = NonNullable<BookListParams['sort']>

// Колонки: название · авторы · год · раздел · наличие · выдано (только staff).
const COLS_STAFF = ['34%', '22%', '5.5rem', '16%', '10rem', '7rem'] as const
const COLS_READER = ['38%', '24%', '5.5rem', '18%', '10rem'] as const
// На узком экране остаются название и наличие: они и отвечают «есть ли книга».
const COLS_NARROW = ['60%', '0', '0', '0', '40%', '0'] as const
const HIDE = {
  authors: 'hidden md:table-cell',
  year: 'hidden lg:table-cell',
  section: 'hidden lg:table-cell',
  onLoan: 'hidden md:table-cell',
}
const SKELETON_STAFF = [
  undefined,
  HIDE.authors,
  HIDE.year,
  HIDE.section,
  undefined,
  HIDE.onLoan,
] as const
const SKELETON_READER = SKELETON_STAFF.slice(0, 5)

export interface CatalogViewProps {
  mode: 'staff' | 'reader'
  /** Куда ведёт книга: `${basePath}/${id}`. */
  basePath: string
  /** Вкладки в шапке (раздел «Библиотека» у админа вуза). */
  headerTabs?: ReactNode
}

export function CatalogView({ mode, basePath, headerTabs }: CatalogViewProps) {
  const t = useTranslations('LibraryCatalog')
  const router = useRouter()
  const staff = mode === 'staff'

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [section, setSection] = useState(ALL_SECTIONS)
  const [available, setAvailable] = useState(false)
  const [archived, setArchived] = useState(false)
  const paged = usePagedSort<BookSort>(PAGE_SIZES[0])
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)

  // Запрос — после паузы в наборе, со сбросом на первую страницу.
  const { setPage } = paged
  useEffect(() => {
    const next = search.trim().slice(0, 100)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced, setPage])

  const params: BookListParams = {
    ...paged.query,
    ...(debounced ? { q: debounced } : {}),
    ...(section !== ALL_SECTIONS ? { section } : {}),
    ...(available ? { available: true } : {}),
    ...(staff && archived ? { archived: true } : {}),
  }
  const books = useQuery({
    queryKey: libraryKeys.books(params),
    queryFn: () => fetchBooks(params),
    placeholderData: keepPreviousData,
  })
  const sections = useQuery({ queryKey: libraryKeys.sections(), queryFn: fetchBookSections })

  const items = books.data?.items ?? []
  const total = books.data?.total ?? 0
  const filtered = Boolean(debounced) || section !== ALL_SECTIONS || available || archived
  const disabled = books.isError && toApiError(books.error).code === 'CONFLICT'

  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }

  const head = (key: BookSort) => ({ sortKey: key, sort: paged.sort, onSort: paged.toggle })

  return (
    // Сквозная flex-цепочка до таблицы: `Table fill` доходит до низа окна, только если
    // каждый предок отдаёт ей высоту.
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={staff ? t('subtitleStaff') : t('subtitleReader')}
        tabs={headerTabs}
        actions={
          disabled ? undefined : (
            <>
              <div className="relative w-full sm:w-64">
                <Search
                  className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  size="md"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchPlaceholder')}
                  className="pl-9"
                />
              </div>
              <Select value={section} onValueChange={(v) => refilter(() => setSection(v))}>
                <SelectTrigger size="md" className="w-full sm:w-52" aria-label={t('section')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SECTIONS}>{t('allSections')}</SelectItem>
                  {(sections.data ?? []).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex h-9 items-center gap-2">
                <Checkbox
                  id="catalog-available"
                  checked={available}
                  onCheckedChange={(v) => refilter(() => setAvailable(v === true))}
                />
                <Label htmlFor="catalog-available">{t('onlyAvailable')}</Label>
              </div>
              {staff && (
                <div className="flex h-9 items-center gap-2">
                  <Checkbox
                    id="catalog-archived"
                    checked={archived}
                    onCheckedChange={(v) => refilter(() => setArchived(v === true))}
                  />
                  <Label htmlFor="catalog-archived">{t('showArchive')}</Label>
                </div>
              )}
              {staff && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setImporting(true)}
                  >
                    <FileUp className="size-4" aria-hidden />
                    {t('import')}
                  </Button>
                  <Button type="button" size="md" onClick={() => setCreating(true)}>
                    <Plus className="size-4" aria-hidden />
                    {t('addBook')}
                  </Button>
                </>
              )}
            </>
          )
        }
      />

      {disabled ? (
        <EmptyState
          icon={<PowerOff className="size-6" aria-hidden />}
          title={t('disabledTitle')}
          description={t('disabledDescription')}
        />
      ) : books.isError ? (
        <EmptyState
          icon={<BookOpen className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void books.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : !books.isPending && items.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-6" aria-hidden />}
          title={filtered ? t('nothingFound') : t('emptyTitle')}
          description={filtered ? undefined : staff ? t('emptyStaffHint') : t('emptyReaderHint')}
          action={
            staff && !filtered ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                {t('addBook')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table
            fixed
            scrollBody
            fill
            cols={staff ? COLS_STAFF : COLS_READER}
            colsNarrow={COLS_NARROW}
          >
            <TableHeader>
              <TableRow>
                <TableHead {...head('title')}>{t('fieldTitle')}</TableHead>
                <TableHead {...head('authors')} className={HIDE.authors}>
                  {t('fieldAuthors')}
                </TableHead>
                <TableHead {...head('year')} className={HIDE.year}>
                  {t('colYear')}
                </TableHead>
                <TableHead className={HIDE.section}>{t('section')}</TableHead>
                <TableHead>{t('colAvailability')}</TableHead>
                {staff && <TableHead className={HIDE.onLoan}>{t('colOnLoan')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {books.isPending && (
                <TableSkeletonRows columns={staff ? SKELETON_STAFF : SKELETON_READER} />
              )}
              {items.map((book) => (
                <BookRow
                  key={book.id}
                  book={book}
                  href={`${basePath}/${book.id}`}
                  staff={staff}
                  onOpen={(href) => router.push(href)}
                />
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={paged.page}
            total={total}
            limit={paged.limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={paged.setLimit}
          />
        </Card>
      )}

      {creating && <BookFormModal basePath={basePath} onClose={() => setCreating(false)} />}
      {importing && <LibraryImportModal onClose={() => setImporting(false)} />}
    </div>
  )
}

function BookRow({
  book,
  href,
  staff,
  onOpen,
}: {
  book: BookCard
  href: string
  staff: boolean
  onOpen: (href: string) => void
}) {
  const t = useTranslations('LibraryCatalog')
  const { available, total, onLoan } = book.availability
  return (
    // Строка открывает книгу целиком; ссылка в названии — для клавиатуры и «открыть
    // в новой вкладке».
    <TableRow onClick={() => onOpen(href)} className="cursor-pointer hover:bg-muted/40">
      <TableCell>
        <span className="flex min-w-0 items-center gap-3">
          <BookCover url={book.coverUrl} title={book.title} className="w-8" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className="block min-w-0 font-medium outline-none focus-visible:underline"
            >
              <TableText value={book.title} />
            </Link>
            {book.archived && (
              <span>
                <Badge variant="outline">{t('archived')}</Badge>
              </span>
            )}
          </span>
        </span>
      </TableCell>
      <TableCell className={cn(HIDE.authors, 'text-muted-foreground')}>
        <TableText value={book.authors} />
      </TableCell>
      <TableCell className={cn(HIDE.year, 'text-muted-foreground tabular-nums')}>
        {book.year ?? <TableEmpty />}
      </TableCell>
      <TableCell className={cn(HIDE.section, 'text-muted-foreground')}>
        <TableText value={book.section} />
      </TableCell>
      <TableCell>
        {total === 0 ? (
          <Badge variant="outline">{t('noCopies')}</Badge>
        ) : available > 0 ? (
          <Badge variant="success">{t('availableOf', { available, total })}</Badge>
        ) : (
          <Badge variant="warning">{t('allOut')}</Badge>
        )}
      </TableCell>
      {staff && (
        <TableCell className={cn(HIDE.onLoan, 'text-muted-foreground tabular-nums')}>
          {onLoan > 0 ? onLoan : <TableEmpty />}
        </TableCell>
      )}
    </TableRow>
  )
}
