'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { CheckCircle2, ClipboardCheck, ScanQrCode, TriangleAlert } from 'lucide-react'
import type { InventoryScanResult, InventoryWarning } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  DatePicker,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  Progress,
  SectionPanel,
  Skeleton,
  TablePagination,
  FieldError,
} from '../../../shared/ui'
import {
  CopyStatusBadge,
  fetchInventory,
  inventoryScanRequest,
  libraryKeys,
} from '../../../entities/library'
import { parseQrTarget } from '../../../features/qr-scan'
import { localToday, useDeskErrors } from '../lib/desk-errors'

// Инвентаризация сканом (Фаза 20.12): библиотекарь идёт вдоль полок и сканирует наклейки —
// экземпляр отмечен «на месте». Отчёт с даты начала показывает, сколько отмечено и что из
// «должно стоять на полке» так и не нашли. Статус экземпляра сканом не меняется: выданный,
// утерянный или списанный экземпляр в руках — предупреждение, решает человек.

const QrScanner = dynamic(() => import('../../../features/qr-scan').then((m) => m.QrScanner), {
  ssr: false,
  loading: () => <Skeleton className="min-h-80 w-full rounded-3xl" />,
})

const PAGE_SIZES = [20, 50, 100] as const
const SINCE_KEY = 'library:inventory-since'
/** Сколько последних сканов держим на экране. */
const RECENT = 20

function storedSince(): string {
  try {
    return window.localStorage.getItem(SINCE_KEY) ?? localToday()
  } catch {
    return localToday()
  }
}

export function InventoryView() {
  const t = useTranslations('LibraryDesk')
  const tScan = useTranslations('QrScan')
  const format = useFormatter()
  const describe = useDeskErrors()
  const qc = useQueryClient()
  const [since, setSinceState] = useState(storedSince)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const [scanning, setScanning] = useState(false)
  // Сканер перезапускается после каждого принятого кода — так он принимает следующий.
  const [scanRound, setScanRound] = useState(0)
  const [manual, setManual] = useState('')
  const [recent, setRecent] = useState<InventoryScanResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const warningText: Record<InventoryWarning, string> = {
    onLoan: t('invWarnOnLoan'),
    lost: t('invWarnLost'),
    writtenOff: t('invWarnWrittenOff'),
  }

  function setSince(v: string): void {
    setSinceState(v)
    setPage(1)
    try {
      window.localStorage.setItem(SINCE_KEY, v)
    } catch {
      // Хранилище недоступно — дата просто не запомнится.
    }
  }

  const params = { since, page, limit }
  const report = useQuery({
    queryKey: libraryKeys.inventory(params),
    queryFn: () => fetchInventory(params),
    placeholderData: keepPreviousData,
  })

  const scanMut = useMutation({
    mutationFn: inventoryScanRequest,
    onSuccess: (result) => {
      setRecent((prev) =>
        [result, ...prev.filter((r) => r.copy.id !== result.copy.id)].slice(0, RECENT),
      )
      setError(null)
      setManual('')
      void qc.invalidateQueries({ queryKey: ['library', 'inventory'] })
    },
    onError: (e) => setError(describe(e)),
    onSettled: () => setScanRound((n) => n + 1),
  })

  const r = report.data
  const percent = r && r.expected > 0 ? Math.round((r.checked / r.expected) * 100) : null

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('inventoryTitle')}
        subtitle={t('inventorySubtitle')}
        actions={
          <>
            <DatePicker
              size="md"
              value={since}
              onChange={setSince}
              max={localToday()}
              aria-label={t('invSince')}
              className="w-full sm:w-48"
            />
            <Button type="button" size="md" onClick={() => setScanning(true)}>
              <ScanQrCode className="size-4" aria-hidden />
              {t('invScan')}
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <SectionPanel
            title={t('invProgress')}
            subtitle={t('invProgressSince', {
              date: format.dateTime(new Date(`${since}T00:00:00`), {
                day: 'numeric',
                month: 'long',
              }),
            })}
          >
            {report.isPending ? (
              <Skeleton className="h-16 w-full rounded-xl" />
            ) : r ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-3xl font-bold tabular-nums">
                    {percent !== null ? `${percent}%` : '—'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t('invChecked', { checked: r.checked, expected: r.expected })}
                  </span>
                </div>
                {percent !== null && <Progress value={percent} />}
                <p className="text-xs text-muted-foreground">
                  {[t('invProgressHint'), r.onLoan > 0 ? t('invOnLoan', { count: r.onLoan }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            ) : null}
          </SectionPanel>

          <SectionPanel title={t('invManual')} subtitle={t('invManualHint')}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const raw = manual.trim()
                if (!raw) return
                const target = parseQrTarget(raw)
                scanMut.mutate(
                  target?.kind === 'bookCopy'
                    ? { copyCode: target.value, since }
                    : { inventoryNumber: raw, since },
                )
              }}
            >
              <Label htmlFor="inv-number" className="sr-only">
                {t('invManual')}
              </Label>
              <Input
                id="inv-number"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder={t('invNumberPlaceholder')}
                autoComplete="off"
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="outline" loading={scanMut.isPending}>
                {t('invMark')}
              </Button>
            </form>
            <FieldError>{error && error}</FieldError>
          </SectionPanel>

          <SectionPanel title={t('invRecent')} subtitle={t('invRecentHint')}>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('invRecentEmpty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {recent.map((item) => (
                  <li key={item.copy.id} className="flex items-center gap-3 py-2">
                    {item.warning ? (
                      <TriangleAlert className="size-5 shrink-0 text-warning" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{item.book.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          t('inventoryShort', { number: item.copy.inventoryNumber }),
                          item.warning ? warningText[item.warning] : null,
                          item.alreadyChecked ? t('invAlready') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <CopyStatusBadge status={item.copy.status} />
                  </li>
                ))}
              </ul>
            )}
          </SectionPanel>
        </div>

        <SectionPanel title={t('invMissing')} subtitle={t('invMissingHint')}>
          {report.isPending ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : !r || r.items.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="size-6" aria-hidden />}
              title={t('invAllFound')}
            />
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border">
                {r.items.map((item) => (
                  <li key={item.copyId}>
                    <Link
                      href={`/library/catalog/${item.book.id}`}
                      className="flex items-center gap-3 py-2 hover:bg-muted/40"
                    >
                      <span className="w-20 shrink-0 font-mono text-sm tabular-nums">
                        {item.inventoryNumber}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{item.book.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {item.inventoriedAt
                            ? t('invLastSeen', {
                                date: format.dateTime(new Date(item.inventoriedAt), {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                }),
                              })
                            : t('invNeverSeen')}
                        </span>
                      </span>
                      {item.status === 'RESERVED' && (
                        <Badge variant="info">{t('invOnHoldShelf')}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              <TablePagination
                page={page}
                total={r.total}
                limit={limit}
                onPageChange={setPage}
                limitOptions={PAGE_SIZES}
                onLimitChange={(n) => {
                  setLimit(n)
                  setPage(1)
                }}
              />
            </>
          )}
        </SectionPanel>
      </div>

      {scanning && (
        <Modal onClose={() => setScanning(false)} title={t('invScan')} size="md">
          <div className="flex h-[60vh] min-h-80 flex-col gap-3">
            {scanMut.isPending ? (
              <Skeleton className="min-h-0 w-full flex-1 rounded-3xl" />
            ) : (
              <QrScanner
                key={scanRound}
                title={t('invScanTitle')}
                hint={t('invScanHint')}
                rejectNotice={tScan('notBookCopy')}
                onScan={(raw) => {
                  const target = parseQrTarget(raw)
                  if (target?.kind !== 'bookCopy') return false
                  scanMut.mutate({ copyCode: target.value, since })
                  return true
                }}
              />
            )}
            {recent[0] && (
              <p className="flex items-center gap-2 text-sm">
                {recent[0].warning ? (
                  <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                )}
                <span className="truncate">
                  {recent[0].book.title} ·{' '}
                  {t('inventoryShort', { number: recent[0].copy.inventoryNumber })}
                </span>
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
