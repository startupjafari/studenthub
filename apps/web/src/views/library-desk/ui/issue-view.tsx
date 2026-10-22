'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { BookCheck, ScanLine, ScanQrCode, TriangleAlert, UserRoundX, X } from 'lucide-react'
import type { LibraryReaderSession, LoanItem, ReaderBlocker } from '@studenthub/shared-schemas'
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
  SectionPanel,
  Skeleton,
} from '../../../shared/ui'
import {
  LoanDueBadge,
  ReaderCard,
  formatCopyCode,
  issueLoanRequest,
  libraryKeys,
  resolveReaderRequest,
} from '../../../entities/library'
import { parseQrTarget } from '../../../features/qr-scan'
import { isTicketError, localToday, useDeskErrors } from '../lib/desk-errors'

// Выдача книг (Фаза 20.4, docs/PROJECT.md §3.11). Два скана: студенческий читателя (разовый
// QR — сервер выдаёт пропуск на 15 минут) и наклейка экземпляра; срок — по правилам вуза.
// По пропуску можно выдать несколько книг подряд, не сканируя студенческий заново.

// Сканер — только на клиенте и лениво: библиотека qr-scanner не попадает в бандл зря.
const QrScanner = dynamic(() => import('../../../features/qr-scan').then((m) => m.QrScanner), {
  ssr: false,
  loading: () => <Skeleton className="min-h-0 w-full flex-1 rounded-3xl" />,
})

export function IssueView() {
  const t = useTranslations('LibraryDesk')
  const tScan = useTranslations('QrScan')
  const describe = useDeskErrors()
  const params = useSearchParams()
  const [session, setSession] = useState<LibraryReaderSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resolved = useRef(false)

  const resolveMut = useMutation({
    mutationFn: resolveReaderRequest,
    onSuccess: (s) => {
      setSession(s)
      setError(null)
    },
    onError: (e) => setError(describe(e)),
  })

  // QR студенческого, отсканированный общим сканером, приходит сюда как ?t=.
  const fromScan = params.get('t')
  useEffect(() => {
    if (fromScan && !resolved.current) {
      resolved.current = true
      resolveMut.mutate(fromScan)
    }
  }, [fromScan, resolveMut])

  if (session) {
    return <ReaderSession session={session} onReset={() => setSession(null)} />
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('issueTitle')} subtitle={t('issueSubtitle')} />
      {resolveMut.isPending ? (
        <Skeleton className="min-h-80 w-full flex-1 rounded-3xl" />
      ) : error ? (
        <EmptyState
          icon={<UserRoundX className="size-6" aria-hidden />}
          title={t('readerFailed')}
          description={error}
          action={
            <Button type="button" onClick={() => setError(null)}>
              <ScanLine className="size-4" aria-hidden />
              {t('scanAgain')}
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-80 w-full flex-1 flex-col">
          <QrScanner
            title={t('scanReaderTitle')}
            hint={t('scanReaderHint')}
            rejectNotice={tScan('notStudentId')}
            onScan={(raw) => {
              const target = parseQrTarget(raw)
              if (target?.kind !== 'studentId') return false
              resolveMut.mutate(target.value)
              return true
            }}
          />
        </div>
      )}
    </div>
  )
}

function ReaderSession({
  session,
  onReset,
}: {
  session: LibraryReaderSession
  onReset: () => void
}) {
  const t = useTranslations('LibraryDesk')
  const tScan = useTranslations('QrScan')
  const format = useFormatter()
  const describe = useDeskErrors()
  const qc = useQueryClient()
  const [copyCode, setCopyCode] = useState<string | null>(null)
  const [inventoryNumber, setInventoryNumber] = useState('')
  const [dueDate, setDueDate] = useState(session.defaultDueDate)
  const [scanning, setScanning] = useState(false)
  const [issued, setIssued] = useState<LoanItem[]>([])
  const [error, setError] = useState<string | null>(null)

  // Выданное в этот раз считаем на месте: пропуск по второму QR не обновить.
  const active = session.eligibility.activeLoans + issued.length
  const blockers: ReaderBlocker[] = [
    ...session.eligibility.blockers.filter((b) => b !== 'limit'),
    ...(active >= session.eligibility.maxActiveLoans ? (['limit'] as const) : []),
  ]
  const blockerText: Record<ReaderBlocker, string> = {
    status: t('error.status'),
    overdue: t('error.overdue'),
    limit: t('error.limit'),
  }
  const openLoans = session.loans.filter((l) => l.status === 'OPEN')

  const issueMut = useMutation({
    mutationFn: () =>
      issueLoanRequest({
        ticket: session.ticket,
        ...(copyCode ? { copyCode } : { inventoryNumber: inventoryNumber.trim() }),
        dueDate,
      }),
    onSuccess: (loan) => {
      setIssued((prev) => [loan, ...prev])
      setCopyCode(null)
      setInventoryNumber('')
      setError(null)
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('issuedToast', { title: loan.book.title }))
    },
    onError: (e) => {
      if (isTicketError(e)) {
        toast.error(describe(e))
        onReset()
        return
      }
      setError(describe(e))
    },
  })

  const ready = Boolean(copyCode || inventoryNumber.trim()) && blockers.length === 0

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title={t('issueTitle')}
        subtitle={t('ticketUntil', {
          time: format.dateTime(new Date(session.ticketExpiresAt), {
            hour: '2-digit',
            minute: '2-digit',
          }),
        })}
        actions={
          <Button type="button" variant="outline" size="md" onClick={onReset}>
            <ScanLine className="size-4" aria-hidden />
            {t('nextReader')}
          </Button>
        }
      />

      <ReaderCard reader={session.reader}>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={blockers.length === 0 ? 'success' : 'destructive'}>
            {blockers.length === 0 ? t('canBorrow') : t('cannotBorrow')}
          </Badge>
          <Badge variant="secondary">
            {t('onHands', { count: active, max: session.eligibility.maxActiveLoans })}
          </Badge>
        </div>
      </ReaderCard>

      {blockers.length > 0 && (
        <Card className="flex-row items-start gap-3 border-destructive/30 bg-destructive/5 p-4">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <ul className="flex flex-col gap-1 text-sm">
            {blockers.map((b) => (
              <li key={b}>{blockerText[b]}</li>
            ))}
          </ul>
        </Card>
      )}

      <SectionPanel title={t('issueBook')} subtitle={t('issueBookHint')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) issueMut.mutate()
          }}
        >
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="issue-copy">{t('copyField')}</Label>
              {copyCode ? (
                <div className="flex h-10 items-center gap-2 rounded-lg border border-border px-3">
                  <Badge variant="secondary" className="font-mono">
                    {formatCopyCode(copyCode)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{t('copyScanned')}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    className="ml-auto"
                    aria-label={t('clearCopy')}
                    onClick={() => setCopyCode(null)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : (
                <Input
                  id="issue-copy"
                  value={inventoryNumber}
                  onChange={(e) => setInventoryNumber(e.target.value)}
                  placeholder={t('inventoryPlaceholder')}
                />
              )}
            </div>
            <div className="flex items-end">
              <Button type="button" variant="outline" onClick={() => setScanning(true)}>
                <ScanQrCode className="size-4" aria-hidden />
                {t('scanCopy')}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label>{t('dueDate')}</Label>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              min={localToday()}
              max={session.maxDueDate}
              aria-label={t('dueDate')}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={!ready} loading={issueMut.isPending}>
              <BookCheck className="size-4" aria-hidden />
              {t('issue')}
            </Button>
          </div>
        </form>
      </SectionPanel>

      {issued.length > 0 && (
        <SectionPanel title={t('issuedNow')} subtitle={t('issuedNowHint')}>
          <LoanList loans={issued} />
        </SectionPanel>
      )}

      <SectionPanel title={t('readerLoans')} subtitle={t('readerLoansHint')}>
        {openLoans.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noOpenLoans')}</p>
        ) : (
          <LoanList loans={openLoans} />
        )}
      </SectionPanel>

      {scanning && (
        <Modal onClose={() => setScanning(false)} title={t('scanCopy')} size="lg">
          <div className="flex h-[60vh] flex-col">
            <QrScanner
              title={t('scanCopyTitle')}
              hint={t('scanCopyHint')}
              rejectNotice={tScan('notStudentHub')}
              onScan={(raw) => {
                const target = parseQrTarget(raw)
                if (target?.kind !== 'bookCopy') return false
                setCopyCode(target.value)
                setScanning(false)
                return true
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

function LoanList({ loans }: { loans: LoanItem[] }) {
  const t = useTranslations('LibraryDesk')
  return (
    <ul className="flex flex-col divide-y divide-border">
      {loans.map((loan) => (
        <li key={loan.id} className="flex items-center gap-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{loan.book.title}</span>
            <span className="text-xs text-muted-foreground">
              {t('inventoryShort', { number: loan.copy.inventoryNumber })}
            </span>
          </div>
          <LoanDueBadge loan={loan} />
        </li>
      ))}
    </ul>
  )
}
