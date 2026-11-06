'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, BadgeCheck, Download, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { ClearanceCertificateItem } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionPanel,
  Skeleton,
} from '../../../shared/ui'
import { saveFile, toApiError } from '../../../shared/lib'
import {
  LoanDueBadge,
  fetchClearance,
  fetchMyClearanceCertificates,
  isLostDebt,
  issueClearanceCertificate,
  libraryKeys,
} from '../../../entities/library'

// Справка «задолженностей в библиотеке нет» (Фаза 20.11, 21.C4): для обходного листа при
// выпуске или переводе. Есть книги на руках — вместо справки список того, что вернуть, а
// утерянную книгу без погашения — заменить или возместить. Нет долгов — PDF с кодом проверки
// и QR: его выпускает сервер и записывает в журнал документов, поэтому подделку проверка по
// коду не подтвердит. Ниже — выданные справки с кодами и статусом (библиотекарь может отозвать).
export function ClearanceView() {
  const t = useTranslations('LibraryReader')
  const tErr = useTranslations('Errors')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const clearance = useQuery({
    queryKey: libraryKeys.clearance(),
    queryFn: fetchClearance,
    staleTime: 0,
  })
  const certificates = useQuery({
    queryKey: libraryKeys.myCertificates(),
    queryFn: fetchMyClearanceCertificates,
  })
  const issue = useMutation({
    mutationFn: () => issueClearanceCertificate(locale),
    onSuccess: (file) => {
      saveFile(file)
      toast.success(t('certificateDownloadedToast'))
      void qc.invalidateQueries({ queryKey: libraryKeys.myCertificates() })
    },
    onError: (e) => {
      const err = toApiError(e)
      if (err.code === 'CONFLICT' && err.details?.[0]?.field === 'debts') {
        // Книгу выдали, пока страница была открыта: показать, что вернуть.
        void qc.invalidateQueries({ queryKey: libraryKeys.clearance() })
        toast.error(t('error.debts'))
        return
      }
      toast.error(tErr(err.code))
    },
  })

  const back = (
    <Button asChild variant="ghost" size="md">
      <Link href="/my-books">
        <ArrowLeft className="size-4" aria-hidden />
        {t('tabMine')}
      </Link>
    </Button>
  )

  if (clearance.isPending) return <Skeleton fill className="min-h-64 rounded-xl" />
  if (clearance.isError) {
    return (
      <EmptyState
        icon={<TriangleAlert className="size-6" aria-hidden />}
        title={t('loadError')}
        action={back}
      />
    )
  }
  const c = clearance.data
  const checked = format.dateTime(new Date(c.checkedAt), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const issued = certificates.data ?? []

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Назад — стрелкой слева, как на остальных экранах с возвратом; справа — справка. */}
      <PageHeader
        title={t('clearanceTitle')}
        subtitle={t('clearanceSubtitle')}
        onBack={() => router.push('/my-books')}
        backLabel={t('tabMine')}
        actions={
          c.clear && (
            <Button
              type="button"
              size="md"
              loading={issue.isPending}
              onClick={() => issue.mutate()}
            >
              <Download className="size-4" aria-hidden />
              {t('downloadCertificate')}
            </Button>
          )
        }
      />
      {c.clear ? (
        <Card className="flex-row items-start gap-3 border-success/40 bg-success/10 p-4">
          <BadgeCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{t('clearTitle')}</p>
            <p className="text-sm">{t('clearBody', { name: c.reader.name, date: checked })}</p>
            <p className="text-sm text-muted-foreground">{t('certificateHint')}</p>
          </div>
        </Card>
      ) : (
        <Card className="flex-col gap-3 border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
            {t('notClearTitle', { count: c.loans.length })}
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {c.loans.map((loan) => (
              <li key={loan.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {loan.book.title}
                </span>
                <LoanDueBadge loan={loan} />
              </li>
            ))}
          </ul>
          {c.loans.some(isLostDebt) && (
            <p className="text-sm text-muted-foreground">{t('lostHint')}</p>
          )}
        </Card>
      )}
      {issued.length > 0 && (
        <SectionPanel
          title={t('myCertificatesTitle')}
          subtitle={t('certificateHint')}
          bodyClassName="px-0 py-0"
        >
          <ul className="flex flex-col divide-y divide-border">
            {issued.map((cert) => (
              <CertificateRow key={cert.code} cert={cert} />
            ))}
          </ul>
        </SectionPanel>
      )}
    </div>
  )
}

function CertificateRow({ cert }: { cert: ClearanceCertificateItem }) {
  const t = useTranslations('LibraryReader')
  const format = useFormatter()
  const revoked = cert.revokedAt !== null
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <span className="font-mono text-sm tracking-wider tabular-nums">
        {t('certificateCode', { code: cert.code })}
      </span>
      <span className="text-sm text-muted-foreground">
        {format.dateTime(new Date(cert.issuedAt), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </span>
      <Badge variant={revoked ? 'destructive' : 'success'}>
        {revoked ? t('certificateRevoked') : t('certificateValid')}
      </Badge>
      <Button asChild variant="ghost" size="sm" className="ml-auto">
        <Link href={`/verify/${cert.code}`} target="_blank" rel="noopener">
          <ShieldCheck className="size-4" aria-hidden />
          {t('certificateVerify')}
        </Link>
      </Button>
    </li>
  )
}
