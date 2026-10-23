'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { FilterX, ScrollText, Search, X } from 'lucide-react'
import {
  DOCUMENT_JOURNAL_ACTIONS,
  type DocumentJournalItem,
  type DocumentJournalQueryInput,
} from '@studenthub/shared-schemas'
import { documentKeys, fetchDocumentJournal } from '../../../entities/document'
import { useDocumentTypeCatalog } from '../../../entities/document-type'
import {
  Badge,
  Button,
  Card,
  DateRangePicker,
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
  type DateRange,
} from '../../../shared/ui'

// Журнал документов вуза для админа вуза (§15.2: «читает журнал», содержимое — нет).
// Кто, над чьим документом, что сделал, когда и через что. Документ — только тип и
// категория: ни названия, ни номера, ни файлов (их нет и в ответе API). Только чтение,
// таблица во всю высоту (DESIGN_SYSTEM §10.7), как журнал просмотров удостоверений.

const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250

// Когда · кто · чей документ · документ · действие · через что.
const COLS = ['13%', '19%', '19%', '19%', '14%', '16%'] as const
const COLS_NARROW = ['28%', '0', '40%', '0', '32%', '0'] as const
const HIDE = {
  actor: 'hidden md:table-cell',
  document: 'hidden lg:table-cell',
  via: 'hidden lg:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.actor, undefined, HIDE.document, undefined, HIDE.via]

type Person = { id: string; name: string }

export function DocumentJournalView() {
  const t = useTranslations('DocumentJournal')
  const tDoc = useTranslations('Documents')
  const tRoles = useTranslations('Roles')
  const tCommon = useTranslations('Common')
  const format = useFormatter()
  const { labelOf } = useDocumentTypeCatalog()

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [action, setAction] = useState<string>('all')
  const [period, setPeriod] = useState<DateRange>({ from: '', to: '' })
  // Клик по имени сужает журнал до человека — и как действующего, и как владельца.
  const [person, setPerson] = useState<Person | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  useEffect(() => {
    const next = search.trim().slice(0, 100)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced])

  // Период — локальные сутки: «по 20.10» значит включая весь день 20-го.
  const params: Partial<DocumentJournalQueryInput> = {
    page,
    limit,
    ...(debounced ? { q: debounced } : {}),
    ...(action !== 'all' ? { action: action as DocumentJournalQueryInput['action'] } : {}),
    ...(period.from ? { from: new Date(`${period.from}T00:00:00`) } : {}),
    ...(period.to ? { to: new Date(`${period.to}T23:59:59.999`) } : {}),
    ...(person ? { userId: person.id } : {}),
  }
  const journal = useQuery({
    queryKey: documentKeys.journal(params),
    queryFn: () => fetchDocumentJournal(params),
    placeholderData: keepPreviousData,
  })
  const items = journal.data?.items ?? []
  const filtered = !!debounced || action !== 'all' || !!period.from || !!period.to || !!person

  function reset(): void {
    setSearch('')
    setDebounced('')
    setAction('all')
    setPeriod({ from: '', to: '' })
    setPerson(null)
    setPage(1)
  }

  function viaLabel(row: DocumentJournalItem): string {
    if (row.via === 'REQUEST') {
      return row.request ? t('viaRequestNamed', { title: row.request.title }) : t('via_REQUEST')
    }
    if (row.granteeType === 'UNIVERSITY') return t('viaGrantUniversity')
    if (row.granteeType === 'DEPARTMENT') return t('viaGrantDepartment')
    if (row.granteeType === 'USER') return t('viaGrantUser')
    return t(`via_${row.via}`)
  }

  function personButton(p: Person, label: string) {
    return (
      <button
        type="button"
        onClick={() => {
          setPerson(p)
          setPage(1)
        }}
        title={t('filterByPerson')}
        className="max-w-full truncate text-left hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <div className="relative w-full sm:w-64">
            <Search
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              size="md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="pl-9"
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={action}
          onValueChange={(v) => {
            setAction(v)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label={t('action')} size="md" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('actionAll')}</SelectItem>
            {DOCUMENT_JOURNAL_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {tDoc(`evt_${a}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          size="md"
          className="w-60"
          value={period}
          onChange={(v) => {
            setPeriod(v)
            setPage(1)
          }}
          aria-label={t('period')}
        />
        {person && (
          <Badge variant="secondary" className="gap-1 py-1">
            {t('person', { name: person.name })}
            <button
              type="button"
              aria-label={t('personClear')}
              onClick={() => setPerson(null)}
              className="rounded-sm hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </Badge>
        )}
        {filtered && (
          <Button type="button" variant="ghost" size="md" onClick={reset}>
            <FilterX className="size-4" aria-hidden /> {t('reset')}
          </Button>
        )}
      </div>

      {journal.isError ? (
        <EmptyState
          icon={<ScrollText className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void journal.refetch()}>
              {tCommon('retry')}
            </Button>
          }
        />
      ) : items.length === 0 && !journal.isPending ? (
        <EmptyState
          icon={<ScrollText className="size-6" aria-hidden />}
          title={filtered ? t('nothingFound') : t('empty')}
          description={filtered ? undefined : t('emptyHint')}
          action={
            filtered ? (
              <Button type="button" variant="outline" onClick={reset}>
                <FilterX className="size-4" aria-hidden /> {t('reset')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colWhen')}</TableHead>
                <TableHead className={HIDE.actor}>{t('colActor')}</TableHead>
                <TableHead>{t('colOwner')}</TableHead>
                <TableHead className={HIDE.document}>{t('colDocument')}</TableHead>
                <TableHead>{t('colAction')}</TableHead>
                <TableHead className={HIDE.via}>{t('colVia')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {journal.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <time dateTime={row.createdAt} className="text-sm tabular-nums">
                      {format.dateTime(new Date(row.createdAt), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </TableCell>
                  <TableCell className={HIDE.actor}>
                    {personButton(row.actor, row.actor.name || t('unknownActor'))}
                    {row.actor.role && (
                      <span className="block text-xs text-muted-foreground">
                        <TableText value={tRoles(row.actor.role)} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{personButton(row.owner, row.owner.name)}</TableCell>
                  <TableCell className={HIDE.document}>
                    <TableText value={labelOf(row.document.type)} />
                    <span className="block text-xs text-muted-foreground">
                      <TableText
                        value={
                          row.document.deleted
                            ? t('documentDeleted', {
                                category: tDoc(`docCat_${row.document.category}`),
                              })
                            : tDoc(`docCat_${row.document.category}`)
                        }
                      />
                    </span>
                  </TableCell>
                  <TableCell>
                    <TableText value={tDoc(`evt_${row.action}`)} />
                  </TableCell>
                  <TableCell className={HIDE.via}>
                    <TableText value={viaLabel(row)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={journal.data?.total ?? 0}
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
