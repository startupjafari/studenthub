'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import type {
  LibraryImportPreviewResponse,
  LibraryImportPreviewRow,
} from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableText,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  libraryImportCommitRequest,
  libraryImportPreviewRequest,
  libraryKeys,
} from '../../../entities/library'

// Импорт фонда из CSV/XLSX (Фаза 20.3): файл разбирает сервер, здесь — предпросмотр с
// ошибками по строкам и запись только готовых строк. Как массовые инвайты.

const PAGE_SIZES = [20, 100, 200] as const
const COLS = ['7%', '33%', '20%', '18%', '10%', '12%'] as const

const STATUS_VARIANT: Record<
  LibraryImportPreviewRow['status'],
  'success' | 'warning' | 'destructive'
> = { READY: 'success', DUPLICATE: 'warning', ERROR: 'destructive' }

export function LibraryImportModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('LibraryCatalog')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<LibraryImportPreviewResponse | null>(null)

  const previewMut = useMutation({
    mutationFn: libraryImportPreviewRequest,
    onSuccess: setPreview,
    onError: (e) => {
      const err = toApiError(e)
      // Отказ разбора — почти всегда формат: подсказка, как должен выглядеть файл.
      toast.error(t('importParseError'), {
        description: err.code === 'BAD_REQUEST' ? t('importFormatHint') : tErr(err.code),
      })
    },
  })

  const commitMut = useMutation({
    mutationFn: () => {
      const rows = (preview?.rows ?? [])
        .filter((r) => r.status === 'READY')
        .map((r) => ({
          line: r.line,
          title: r.title,
          authors: r.authors,
          isbn: r.isbn,
          publisher: r.publisher,
          year: r.year,
          section: r.section,
          inventoryNumbers: r.inventoryNumbers,
          count: r.count,
        }))
      return libraryImportCommitRequest({ rows })
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(
        t('importDone', { books: result.books, matched: result.matched, copies: result.copies }),
      )
      onClose()
    },
    onError: (e) => {
      const err = toApiError(e)
      // Номер заняли между предпросмотром и записью — говорим, что именно, а не «конфликт».
      const field = err.details?.[0]?.field
      if (err.code === 'CONFLICT' && field === 'inventoryNumbers') {
        toast.error(t('inventoryTaken'))
      } else toast.error(tErr(err.code))
    },
  })

  const summary = preview?.summary

  return (
    <Modal onClose={onClose} title={t('importTitle')} size="3xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('importHint')}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) previewMut.mutate(file)
          }}
        />
        <div>
          <Button
            type="button"
            variant="outline"
            loading={previewMut.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" aria-hidden />
            {preview ? t('importAnotherFile') : t('importChooseFile')}
          </Button>
        </div>

        {previewMut.isPending && <Skeleton className="h-48 w-full" />}

        {preview && summary && (
          <>
            <p className="text-sm">
              {t('importSummary', {
                total: summary.total,
                ready: summary.ready,
                duplicate: summary.duplicate,
                error: summary.error,
                copies: summary.copies,
              })}
            </p>
            <PreviewTable rows={preview.rows} />
          </>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!summary || summary.ready === 0}
            loading={commitMut.isPending}
            onClick={() => commitMut.mutate()}
          >
            {t('importCommit', { count: summary?.ready ?? 0 })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function PreviewTable({ rows }: { rows: LibraryImportPreviewRow[] }) {
  const t = useTranslations('LibraryCatalog')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  if (rows.length === 0) return <EmptyState title={t('importEmpty')} />
  // Строки ещё не сохранены и как списка на сервере не существуют — пагинация клиентская.
  const pages = Math.max(1, Math.ceil(rows.length / limit))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * limit, current * limit)
  const statusLabel: Record<LibraryImportPreviewRow['status'], string> = {
    READY: t('importStatus.READY'),
    DUPLICATE: t('importStatus.DUPLICATE'),
    ERROR: t('importStatus.ERROR'),
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table fixed scrollBody cols={COLS}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('importColLine')}</TableHead>
            <TableHead>{t('fieldTitle')}</TableHead>
            <TableHead>{t('fieldAuthors')}</TableHead>
            <TableHead>{t('importColCopies')}</TableHead>
            <TableHead>{t('importColStatus')}</TableHead>
            <TableHead>{t('importColError')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="max-h-[45vh]">
          {visible.map((r) => (
            <TableRow key={r.line} className="align-top">
              <TableCell className="tabular-nums text-muted-foreground">{r.line}</TableCell>
              <TableCell>
                <TableText value={r.title} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                <TableText value={r.authors} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                <TableText
                  value={
                    r.inventoryNumbers.length > 0
                      ? r.inventoryNumbers.join(', ') + (r.count ? ` + ${r.count}` : '')
                      : t('importCopiesCount', { count: r.count })
                  }
                />
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status]}>{statusLabel[r.status]}</Badge>
              </TableCell>
              <TableCell className="text-destructive">
                <TableText value={r.error ?? ''} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        page={current}
        total={rows.length}
        limit={limit}
        onPageChange={setPage}
        limitOptions={PAGE_SIZES}
        onLimitChange={(n) => {
          setLimit(n)
          setPage(1)
        }}
      />
    </div>
  )
}
