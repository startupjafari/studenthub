'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
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
  Skeleton,
  TablePagination,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
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
// Список — карточками-строками (идиом системы), пагинация серверная.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250
const ALL_SECTIONS = '__all__'

export interface CatalogViewProps {
  mode: 'staff' | 'reader'
  /** Куда ведёт книга: `${basePath}/${id}`. */
  basePath: string
  /** Вкладки в шапке (раздел «Библиотека» у админа вуза). */
  headerTabs?: ReactNode
}

export function CatalogView({ mode, basePath, headerTabs }: CatalogViewProps) {
  const t = useTranslations('LibraryCatalog')
  const staff = mode === 'staff'

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [section, setSection] = useState(ALL_SECTIONS)
  const [available, setAvailable] = useState(false)
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)

  // Запрос — после паузы в наборе, со сбросом на первую страницу.
  useEffect(() => {
    const next = search.trim().slice(0, 100)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced])

  const params: BookListParams = {
    page,
    limit,
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

  return (
    <div className="flex w-full flex-col gap-6">
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
      ) : (
        <>
          {books.isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
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
          ) : items.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-6" aria-hidden />}
              title={filtered ? t('nothingFound') : t('emptyTitle')}
              description={
                filtered ? undefined : staff ? t('emptyStaffHint') : t('emptyReaderHint')
              }
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
            <>
              <ul className="flex flex-col gap-2">
                {items.map((book) => (
                  <li key={book.id}>
                    <BookRow book={book} href={`${basePath}/${book.id}`} staff={staff} />
                  </li>
                ))}
              </ul>
              <Card className="gap-0 py-0">
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
            </>
          )}
        </>
      )}

      {creating && <BookFormModal basePath={basePath} onClose={() => setCreating(false)} />}
      {importing && <LibraryImportModal onClose={() => setImporting(false)} />}
    </div>
  )
}

function BookRow({ book, href, staff }: { book: BookCard; href: string; staff: boolean }) {
  const t = useTranslations('LibraryCatalog')
  const { available, total } = book.availability
  const meta = [book.authors, book.year ? String(book.year) : null].filter(Boolean).join(' · ')
  return (
    <Link
      href={href}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <Card className="flex-row items-center gap-4 px-4 py-3 transition-colors group-hover:bg-muted/40">
        <BookCover url={book.coverUrl} title={book.title} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-semibold">{book.title}</span>
          {meta && <span className="truncate text-sm text-muted-foreground">{meta}</span>}
          <span className="flex flex-wrap items-center gap-1.5">
            {book.section && <Badge variant="secondary">{book.section}</Badge>}
            {book.archived && <Badge variant="outline">{t('archived')}</Badge>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-right">
          {total === 0 ? (
            <Badge variant="outline">{t('noCopies')}</Badge>
          ) : available > 0 ? (
            <Badge variant="success">{t('availableOf', { available, total })}</Badge>
          ) : (
            <Badge variant="warning">{t('allOut')}</Badge>
          )}
          {staff && book.availability.onLoan > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('onLoanCount', { count: book.availability.onLoan })}
            </span>
          )}
        </span>
      </Card>
    </Link>
  )
}
