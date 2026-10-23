'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { BookCheck, Keyboard, ScanLine, TriangleAlert, UserRoundX } from 'lucide-react'
import type { LibraryReaderSession, LoanItem, ReaderBlocker } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  DatePicker,
  EmptyState,
  Input,
  Label,
  PageHeader,
  SectionPanel,
  Skeleton,
  FieldError,
} from '../../../shared/ui'
import {
  LoanDueBadge,
  ReaderCard,
  fetchLoans,
  issueLoanRequest,
  libraryKeys,
  resolveReaderRequest,
} from '../../../entities/library'
import { parseQrTarget } from '../../../features/qr-scan'
import { isTicketError, localToday, useDeskErrors } from '../lib/desk-errors'
import { CopyPicker, copyRefInput, hasCopyRef, type CopyRef } from './copy-picker'

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
    <div className="flex w-full flex-col gap-6 lg:flex-1">
      <PageHeader title={t('issueTitle')} subtitle={t('issueSubtitle')} />
      {/* На компьютере экран стойки занимает всю высоту окна: камера слева, справа три
          панели, последняя добирает остаток. На узких — колонкой, камера по пропорции. */}
      <div className="grid items-start gap-6 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch">
        <div className="flex aspect-[3/4] w-full flex-col sm:aspect-[4/3] lg:aspect-auto lg:min-h-[24rem]">
          {resolveMut.isPending ? (
            <Skeleton className="min-h-0 w-full flex-1 rounded-3xl" />
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
          )}
        </div>
        <div className="flex flex-col gap-6">
          <ManualCode
            busy={resolveMut.isPending}
            onCode={(token) => {
              setError(null)
              resolveMut.mutate(token)
            }}
          />
          <SectionPanel title={t('howToIssue')} subtitle={t('howToIssueHint')}>
            <ol className="flex flex-col gap-3">
              {[t('step1'), t('step2'), t('step3')].map((text, i) => (
                <li key={text} className="flex items-start gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{text}</span>
                </li>
              ))}
            </ol>
          </SectionPanel>
          <RecentLoans className="lg:flex-1" />
        </div>
      </div>
    </div>
  )
}

/**
 * Код студенческого без камеры: настольный ручной сканер «печатает» содержимое QR в поле
 * как клавиатура и жмёт Enter, а скопированную ссылку можно вставить. Принимается то же,
 * что и с камеры — ссылка проверки студенческого (разовый код), а не номер билета.
 */
function ManualCode({ busy, onCode }: { busy: boolean; onCode: (token: string) => void }) {
  const t = useTranslations('LibraryDesk')
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)

  function submit(): void {
    const raw = value.trim()
    if (!raw) return
    const target = parseQrTarget(raw)
    if (target?.kind === 'studentId') {
      onCode(target.value)
      setValue('')
      setInvalid(false)
      return
    }
    setInvalid(true)
  }

  return (
    <SectionPanel title={t('manualTitle')} subtitle={t('manualHint')}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Label htmlFor="reader-code" className="sr-only">
          {t('manualTitle')}
        </Label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Keyboard
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="reader-code"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setInvalid(false)
              }}
              placeholder={t('manualPlaceholder')}
              aria-invalid={invalid}
              autoComplete="off"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" loading={busy}>
            {t('manualSubmit')}
          </Button>
        </div>
        <FieldError>{invalid && t('manualInvalid')}</FieldError>
      </form>
    </SectionPanel>
  )
}

const RECENT_LIMIT = 5

/** Последние выдачи — чтобы видеть, что только что оформлено, не уходя со стойки. */
function RecentLoans({ className }: { className?: string }) {
  const t = useTranslations('LibraryDesk')
  const params = { filter: 'all' as const, page: 1, limit: RECENT_LIMIT }
  const recent = useQuery({
    queryKey: libraryKeys.loans(params),
    queryFn: () => fetchLoans(params),
  })
  const items = recent.data?.items ?? []
  return (
    <SectionPanel title={t('recentTitle')} subtitle={t('recentHint')} className={className}>
      {recent.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noLoans')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((loan) => (
            <li key={loan.id} className="flex items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{loan.book.title}</span>
                <span className="truncate text-xs text-muted-foreground">{loan.reader.name}</span>
              </div>
              <LoanDueBadge loan={loan} />
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
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
  const format = useFormatter()
  const describe = useDeskErrors()
  const qc = useQueryClient()
  const [copy, setCopy] = useState<CopyRef>({ copyCode: null, inventoryNumber: '' })
  const [dueDate, setDueDate] = useState(session.defaultDueDate)
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
    lost: t('error.lost'),
    limit: t('error.limit'),
  }
  const openLoans = session.loans.filter((l) => l.status === 'OPEN')

  const issueMut = useMutation({
    mutationFn: () =>
      issueLoanRequest({
        ticket: session.ticket,
        ...copyRefInput(copy),
        dueDate,
      }),
    onSuccess: (loan) => {
      setIssued((prev) => [loan, ...prev])
      setCopy({ copyCode: null, inventoryNumber: '' })
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

  const ready = hasCopyRef(copy) && blockers.length === 0

  return (
    <div className="flex w-full flex-col gap-6">
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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
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
              <CopyPicker value={copy} onChange={setCopy} />
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
        </div>
        <div className="flex min-w-0 flex-col gap-6">
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
        </div>
      </div>
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
