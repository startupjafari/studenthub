'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { BadgeCheck, Clock, Info, Loader2, ScanLine, TriangleAlert } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { Button, Card, CardContent, Skeleton } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { studentIdKeys, verifyStudentId } from '../../../entities/student-id'
import { StudentIdCardFace } from './student-id-card'

// Сканер грузим лениво (камера — только на клиенте): библиотека qr-scanner не попадает в бандл,
// пока сотрудник не откроет проверку без токена.
const QrScanner = dynamic(() => import('../../../features/verify-scan').then((m) => m.QrScanner), {
  ssr: false,
  loading: () => <Skeleton className="min-h-[70vh] w-full rounded-3xl" />,
})

// Роли, которым доступна проверка студенческого (сканер внутри приложения).
const STAFF_ROLES: Role[] = [
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
  Role.TEACHER,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
]

// Верификация студенческого сотрудником (задача 20): камера открывает /verify-id?t=…,
// показываем подлинную карту с зелёной отметкой или ошибку.
export function VerifyIdView() {
  const t = useTranslations('StudentId')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const role = useAppSelector((s) => s.auth.role)
  const params = useSearchParams()
  // Токен либо из ссылки (?t=, скан внешней камерой), либо из встроенного сканера.
  const [scanned, setScanned] = useState<string | null>(null)
  const token = params.get('t') ?? scanned ?? ''
  const isStaff = role != null && STAFF_ROLES.includes(role)

  const q = useQuery({
    queryKey: studentIdKeys.verify(token),
    queryFn: () => verifyStudentId(token),
    enabled: token.length > 0,
    retry: false,
  })

  // Нет токена: сотруднику показываем встроенный сканер камеры; остальным — подсказку.
  if (!token) {
    if (isStaff) {
      // Иммерсивный сканер сам показывает заголовок/подсказку — PageHeader не дублируем.
      return (
        <div className="mx-auto w-full max-w-md">
          <QrScanner onToken={setScanned} />
        </div>
      )
    }
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
        {scanned && (
          <Button variant="outline" onClick={() => setScanned(null)}>
            <ScanLine className="size-4" aria-hidden />
            {t('scanAnother')}
          </Button>
        )}
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
      {/* После скана внутри приложения — проверить следующего студента. */}
      {scanned && (
        <Button variant="outline" className="self-center" onClick={() => setScanned(null)}>
          <ScanLine className="size-4" aria-hidden />
          {t('scanAnother')}
        </Button>
      )}
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
