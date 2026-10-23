'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { CheckCircle2, ClipboardCheck, ScanQrCode, TriangleAlert } from 'lucide-react'
import type { InventoryScanResult, InventoryWarning } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  DatePicker,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  Progress,
  SectionPanel,
  Skeleton,
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
  FieldError,
} from '../../../shared/ui'
import {
  CopyStatusBadge,
  fetchInventory,
  inventoryScanRequest,
  libraryKeys,
} from '../../../entities/library'
import { cn } from '../../../shared/lib'
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

// «Не найдено»: инв. номер · книга · авторы · последняя отметка · статус.
const COLS = ['7rem', '34%', '24%', 'calc(42% - 16rem)', '9rem'] as const
// На узком экране — номер, книга и статус: этого хватает, чтобы пойти искать на полке.
const COLS_NARROW = ['5.5rem', 'calc(100% - 13rem)', '0', '0', '7.5rem'] as const
const HIDE = { authors: 'hidden md:table-cell', lastSeen: 'hidden md:table-cell' } as const
const SKELETON_COLS = [undefined, undefined, HIDE.authors, HIDE.lastSeen, undefined]
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
  const router = useRouter()
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
    // `min-h-0` у корня: список «Не найдено» прокручивается внутри панели, а не страницей.
    <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1">
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

      {/* Слева — ход и список «Не найдено» до низа окна, справа (~20%) — ручная отметка и
          только что отмеченные. На узком экране — колонкой: ход, отметка, отмеченные, а
          длинный список последним, чтобы стойка не листала его до поля ввода. */}
      <div className="grid gap-6 lg:min-h-80 lg:flex-1 lg:grid-cols-[minmax(0,4fr)_minmax(16rem,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        {/* Ход — компактной плиткой, как KPI: цифра и полоса, без шапки панели. */}
        <Card className="gap-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold">{t('invProgress')}</span>
              <span className="text-xs text-muted-foreground">
                {t('invProgressSince', {
                  date: format.dateTime(new Date(`${since}T00:00:00`), {
                    day: 'numeric',
                    month: 'long',
                  }),
                })}
              </span>
            </div>
            {report.isPending ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <span className="text-2xl leading-none font-bold tabular-nums">
                {percent !== null ? `${percent}%` : '—'}
              </span>
            )}
          </div>
          {report.isPending ? (
            <Skeleton className="h-2 w-full rounded-full" />
          ) : r ? (
            <>
              {percent !== null && <Progress value={percent} />}
              <p className="text-xs text-muted-foreground">
                {[
                  t('invChecked', { checked: r.checked, expected: r.expected }),
                  t('invProgressHint'),
                  r.onLoan > 0 ? t('invOnLoan', { count: r.onLoan }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </>
          ) : null}
        </Card>

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

        <SectionPanel
          title={t('invRecent')}
          subtitle={t('invRecentHint')}
          className="lg:col-start-2 lg:row-start-2 lg:min-h-0"
          bodyClassName="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
        >
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

        <SectionPanel
          title={t('invMissing')}
          subtitle={t('invMissingHint')}
          className="lg:col-start-1 lg:row-start-2 lg:min-h-0"
          bodyClassName="flex flex-col p-0 lg:min-h-0 lg:flex-1"
        >
          {r && r.items.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="size-6" aria-hidden />}
              title={t('invAllFound')}
              className="m-4"
            />
          ) : (
            <>
              <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colInventoryNumber')}</TableHead>
                    <TableHead>{t('colBook')}</TableHead>
                    <TableHead className={HIDE.authors}>{t('colAuthors')}</TableHead>
                    <TableHead className={HIDE.lastSeen}>{t('colLastSeen')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
                  {r?.items.map((item) => {
                    const href = `/library/catalog/${item.book.id}`
                    return (
                      <TableRow
                        key={item.copyId}
                        onClick={() => router.push(href)}
                        className="cursor-pointer hover:bg-muted/40"
                      >
                        <TableCell className="font-mono tabular-nums">
                          <TableText value={item.inventoryNumber} />
                        </TableCell>
                        <TableCell className="font-medium">
                          {/* Ссылка — для клавиатуры и «открыть в новой вкладке». */}
                          <Link
                            href={href}
                            onClick={(e) => e.stopPropagation()}
                            className="block min-w-0 outline-none focus-visible:underline"
                          >
                            <TableText value={item.book.title} />
                          </Link>
                        </TableCell>
                        <TableCell className={cn(HIDE.authors, 'text-muted-foreground')}>
                          <TableText value={item.book.authors} />
                        </TableCell>
                        <TableCell className={cn(HIDE.lastSeen, 'text-muted-foreground')}>
                          <TableText
                            value={
                              item.inventoriedAt
                                ? format.dateTime(new Date(item.inventoriedAt), {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })
                                : t('invNeverSeen')
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {item.status === 'RESERVED' ? (
                            <Badge variant="info">{t('invOnHoldShelf')}</Badge>
                          ) : (
                            <TableEmpty />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <TablePagination
                page={page}
                total={r?.total ?? 0}
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
