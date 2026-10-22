'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  History,
  ImageUp,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  PageHeader,
  SectionPanel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableText,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  BookCover,
  CopyStatusBadge,
  bookCopyLabelsRequest,
  fetchBook,
  formatCopyCode,
  libraryKeys,
  rotateBookCopyCodeRequest,
  updateBookRequest,
  uploadBookCoverRequest,
  type BookCopyItem,
  type BookCopyLabel,
  type BookDetail,
} from '../../../entities/library'
import { AddCopiesModal } from './add-copies-modal'
import { BookFormModal } from './book-form-modal'
import { BookLabelSheet } from './book-label-sheet'
import { CopyEditModal } from './copy-edit-modal'
import { CopyHistoryModal } from './copy-history-modal'
import { useConditionLabels } from '../lib/use-condition-labels'

// Книга глазами фонда (Фаза 20.3): карточка, экземпляры с кому выдано и до какого срока,
// печать QR-наклеек, заведение и правка экземпляров, архив.

const COLS = ['2.5rem', '16%', '14%', '14%', '12%', '28%', '9rem'] as const
const HIDE = { code: 'hidden md:table-cell', condition: 'hidden lg:table-cell' } as const

export function BookDetailView({ bookId, basePath }: { bookId: string; basePath: string }) {
  const t = useTranslations('LibraryCatalog')
  const tErr = useTranslations('Errors')
  const format = useFormatter()
  const confirm = useConfirm()
  const router = useRouter()
  const qc = useQueryClient()
  const conditionLabel = useConditionLabels()
  const coverInput = useRef<HTMLInputElement>(null)

  const book = useQuery({
    queryKey: libraryKeys.book(bookId),
    queryFn: () => fetchBook<BookDetail>(bookId),
  })
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingCopy, setEditingCopy] = useState<BookCopyItem | null>(null)
  const [historyCopy, setHistoryCopy] = useState<BookCopyItem | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<BookCopyLabel[]>([])

  const invalidate = (): void => void qc.invalidateQueries({ queryKey: libraryKeys.all })
  const onError = (e: unknown): void => void toast.error(tErr(toApiError(e).code))

  const print = (labels: BookCopyLabel[]): void => {
    setSheet(labels)
    requestAnimationFrame(() => window.print())
  }

  const labelsMut = useMutation({ mutationFn: bookCopyLabelsRequest, onSuccess: print, onError })
  const rotateMut = useMutation({
    mutationFn: rotateBookCopyCodeRequest,
    onSuccess: (label) => {
      invalidate()
      toast.success(t('codeRotated'))
      print([label])
    },
    onError,
  })
  const archiveMut = useMutation({
    mutationFn: (archived: boolean) => updateBookRequest(bookId, { archived }),
    onSuccess: (saved) => {
      invalidate()
      toast.success(saved.archived ? t('archivedToast') : t('restoredToast'))
    },
    onError: (e) => {
      const err = toApiError(e)
      if (err.code === 'CONFLICT') toast.error(t('archiveBusy'))
      else onError(e)
    },
  })
  const coverMut = useMutation({
    mutationFn: (file: File) => uploadBookCoverRequest(bookId, file),
    onSuccess: () => {
      invalidate()
      toast.success(t('coverSaved'))
    },
    onError,
  })

  if (book.isPending) {
    return (
      <div className="flex w-full flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }
  if (book.isError) {
    return (
      <EmptyState
        icon={<BookOpen className="size-6" aria-hidden />}
        title={toApiError(book.error).code === 'NOT_FOUND' ? t('bookNotFound') : t('loadError')}
        action={
          <Button type="button" variant="outline" onClick={() => router.push(basePath)}>
            {t('backToCatalog')}
          </Button>
        }
      />
    )
  }

  const data = book.data
  const copies = data.copies
  const allSelected = copies.length > 0 && copies.every((c) => selected.has(c.id))
  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function toggleArchive(): Promise<void> {
    if (!data.archived) {
      const ok = await confirm({
        title: t('archiveTitle'),
        description: t('archiveDesc'),
        confirmLabel: t('archive'),
      })
      if (!ok) return
    }
    archiveMut.mutate(!data.archived)
  }

  async function rotate(copy: BookCopyItem): Promise<void> {
    const ok = await confirm({
      title: t('rotateTitle'),
      description: t('rotateDesc', { number: copy.inventoryNumber }),
      confirmLabel: t('rotate'),
      destructive: true,
    })
    if (ok) rotateMut.mutate(copy.id)
  }

  const facts = [
    data.isbn ? { label: 'ISBN', value: data.isbn } : null,
    data.publisher ? { label: t('fieldPublisher'), value: data.publisher } : null,
    data.year ? { label: t('fieldYear'), value: String(data.year) } : null,
    data.section ? { label: t('section'), value: data.section } : null,
  ].filter((f): f is { label: string; value: string } => f !== null)

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="sh-no-print flex flex-col gap-4">
        <PageHeader
          title={data.title}
          subtitle={data.authors || undefined}
          onBack={() => router.push(basePath)}
          actions={
            <>
              <Button type="button" variant="outline" size="md" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                {t('editBook')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="md"
                loading={archiveMut.isPending}
                onClick={() => void toggleArchive()}
              >
                {data.archived ? (
                  <ArchiveRestore className="size-4" aria-hidden />
                ) : (
                  <Archive className="size-4" aria-hidden />
                )}
                {data.archived ? t('restore') : t('archive')}
              </Button>
            </>
          }
        />

        <Card className="flex-row gap-4 p-4">
          <div className="flex flex-col items-center gap-2">
            <BookCover url={data.coverUrl} title={data.title} className="w-24" />
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) coverMut.mutate(file)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={coverMut.isPending}
              onClick={() => coverInput.current?.click()}
            >
              <ImageUp className="size-4" aria-hidden />
              {t('cover')}
            </Button>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {data.archived && <Badge variant="outline">{t('archived')}</Badge>}
              <Badge variant={data.availability.available > 0 ? 'success' : 'warning'}>
                {t('availableOf', {
                  available: data.availability.available,
                  total: data.availability.total,
                })}
              </Badge>
              {data.availability.onLoan > 0 && (
                <Badge variant="info">
                  {t('onLoanCount', { count: data.availability.onLoan })}
                </Badge>
              )}
              {data.availability.reserved > 0 && (
                <Badge variant="warning">
                  {t('reservedCount', { count: data.availability.reserved })}
                </Badge>
              )}
            </div>
            {facts.length > 0 && (
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {facts.map((f) => (
                  <div key={f.label} className="flex gap-2">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="min-w-0 truncate">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {data.description && (
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                {data.description}
              </p>
            )}
          </div>
        </Card>

        <SectionPanel
          title={t('copiesTitle')}
          subtitle={t('copiesSubtitle')}
          bodyClassName="px-0 py-0"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selected.size === 0}
                loading={labelsMut.isPending}
                onClick={() => labelsMut.mutate([...selected])}
              >
                <Printer className="size-4" aria-hidden />
                {t('printLabels', { count: selected.size })}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={data.archived}
                onClick={() => setAdding(true)}
              >
                <Plus className="size-4" aria-hidden />
                {t('addCopies')}
              </Button>
            </>
          }
        >
          {copies.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-6" aria-hidden />}
              title={t('noCopiesTitle')}
              description={t('noCopiesHint')}
            />
          ) : (
            <Table fixed cols={COLS}>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox
                      checked={allSelected}
                      aria-label={t('selectAll')}
                      onCheckedChange={(v) =>
                        setSelected(v === true ? new Set(copies.map((c) => c.id)) : new Set())
                      }
                    />
                  </TableHead>
                  <TableHead>{t('inventoryNumber')}</TableHead>
                  <TableHead className={HIDE.code}>{t('code')}</TableHead>
                  <TableHead>{t('statusLabel')}</TableHead>
                  <TableHead className={HIDE.condition}>{t('condition')}</TableHead>
                  <TableHead>{t('reader')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {copies.map((copy) => {
                  const overdue = copy.loan ? new Date(copy.loan.dueAt) < new Date() : false
                  return (
                    <TableRow key={copy.id} className="hover:bg-muted/40">
                      <TableCell>
                        <Checkbox
                          checked={selected.has(copy.id)}
                          aria-label={t('selectCopy', { number: copy.inventoryNumber })}
                          onCheckedChange={() => toggle(copy.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        <TableText value={copy.inventoryNumber} />
                      </TableCell>
                      <TableCell className={cn(HIDE.code, 'font-mono text-muted-foreground')}>
                        {formatCopyCode(copy.code)}
                      </TableCell>
                      <TableCell>
                        <CopyStatusBadge status={copy.status} />
                      </TableCell>
                      <TableCell className={cn(HIDE.condition, 'text-muted-foreground')}>
                        {conditionLabel[copy.condition]}
                      </TableCell>
                      <TableCell>
                        {copy.loan ? (
                          <span className="flex min-w-0 flex-col">
                            <TableText value={copy.loan.readerName} />
                            <span
                              className={cn(
                                'text-xs',
                                overdue ? 'text-destructive' : 'text-muted-foreground',
                              )}
                            >
                              {t('dueUntil', {
                                date: format.dateTime(new Date(copy.loan.dueAt), {
                                  day: 'numeric',
                                  month: 'short',
                                }),
                              })}
                              {copy.loan.readerGroup ? ` · ${copy.loan.readerGroup}` : ''}
                            </span>
                          </span>
                        ) : copy.note ? (
                          <span className="text-muted-foreground">
                            <TableText value={copy.note} />
                          </span>
                        ) : (
                          <TableEmpty />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon
                            aria-label={t('printOne')}
                            title={t('printOne')}
                            onClick={() => labelsMut.mutate([copy.id])}
                          >
                            <Printer className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon
                            aria-label={t('rotate')}
                            title={t('rotate')}
                            onClick={() => void rotate(copy)}
                          >
                            <RefreshCw className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon
                            aria-label={t('history')}
                            title={t('history')}
                            onClick={() => setHistoryCopy(copy)}
                          >
                            <History className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon
                            aria-label={t('editCopy')}
                            title={t('editCopy')}
                            onClick={() => setEditingCopy(copy)}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </SectionPanel>
      </div>

      {editing && (
        <BookFormModal book={data} basePath={basePath} onClose={() => setEditing(false)} />
      )}
      {adding && (
        <AddCopiesModal
          bookId={bookId}
          onClose={() => setAdding(false)}
          onAdded={(added) => setSelected(new Set(added.map((c) => c.id)))}
        />
      )}
      {editingCopy && <CopyEditModal copy={editingCopy} onClose={() => setEditingCopy(null)} />}
      {historyCopy && <CopyHistoryModal copy={historyCopy} onClose={() => setHistoryCopy(null)} />}
      {/* Лист для печати: на экране скрыт, при печати — единственное, что попадает на бумагу. */}
      {sheet.length > 0 && <BookLabelSheet items={sheet} />}
    </div>
  )
}
