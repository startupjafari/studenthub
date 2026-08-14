'use client'

import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { BadgeCheck, Clock, Info, Loader2, TriangleAlert } from 'lucide-react'
import { Card, CardContent } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { studentIdKeys, verifyStudentId } from '../../../entities/student-id'
import { StudentIdCardFace } from './student-id-card'

// Верификация студенческого сотрудником (задача 20): камера открывает /verify-id?t=…,
// показываем подлинную карту с зелёной отметкой или ошибку.
export function VerifyIdView() {
  const t = useTranslations('StudentId')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const params = useSearchParams()
  const token = params.get('t') ?? ''

  const q = useQuery({
    queryKey: studentIdKeys.verify(token),
    queryFn: () => verifyStudentId(token),
    enabled: token.length > 0,
    retry: false,
  })

  if (!token) {
    return (
      <CenterCard>
        <Info className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">{t('verifyNoToken')}</h1>
        <p className="text-sm text-muted-foreground">{t('verifyNoTokenHint')}</p>
      </CenterCard>
    )
  }

  if (q.isLoading) {
    return (
      <CenterCard>
        <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('verifyLoading')}</p>
      </CenterCard>
    )
  }

  if (q.isError || !q.data) {
    return (
      <CenterCard>
        <TriangleAlert className="size-10 text-destructive" aria-hidden />
        <h1 className="text-lg font-semibold">{t('verifyFailed')}</h1>
        <p className="text-sm text-muted-foreground">
          {q.error ? tErr(toApiError(q.error).code) : t('verifyFailedHint')}
        </p>
      </CenterCard>
    )
  }

  const verifiedTime = new Date(q.data.verifiedAt).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {/* Явный визуальный статус «✓ Подтверждено StudentHub». */}
      <div className="flex items-center justify-center gap-2 rounded-xl bg-success/10 p-3 text-sm font-semibold text-success">
        <BadgeCheck className="size-5" aria-hidden />
        {t('verifiedBadge')}
      </div>
      <StudentIdCardFace card={q.data} />
      {/* Время проверки. */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden />
        {t('verifiedAt', { time: verifiedTime })}
      </div>
    </div>
  )
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md items-center justify-center">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          {children}
        </CardContent>
      </Card>
    </div>
  )
}
