'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  BadgeCheck,
  Clock,
  Info,
  Loader2,
  ScanLine,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { Button, Card, CardContent, Skeleton } from '../../../shared/ui'
import { cn, toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { NO_RESYNC_META } from '../../../shared/realtime'
import { StudentIdCardFace, studentIdKeys, verifyStudentId } from '../../../entities/student-id'
import { parseQrTarget } from '../../../features/qr-scan'

// Сканер грузим лениво (камера — только на клиенте): библиотека qr-scanner не попадает в бандл,
// пока сотрудник не откроет проверку без токена.
const QrScanner = dynamic(() => import('../../../features/qr-scan').then((m) => m.QrScanner), {
  ssr: false,
  loading: () => <Skeleton className="min-h-0 w-full flex-1 rounded-3xl" />,
})

// Роли, которым доступна проверка студенческого (сканер внутри приложения).
const STAFF_ROLES: Role[] = [
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
  Role.TEACHER,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  // Охрана на входе: проверка студенческого — её главная работа.
  Role.SECURITY_GUARD,
]

// Верификация студенческого сотрудником (задача 20): камера открывает /verify-id?t=…,
// показываем подлинную карту с зелёной отметкой или ошибку.
export function VerifyIdView() {
  const t = useTranslations('StudentId')
  const tScan = useTranslations('QrScan')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const role = useAppSelector((s) => s.auth.role)
  const params = useSearchParams()
  // Токен либо из ссылки (?t=, скан внешней камерой), либо из встроенного сканера.
  const [scanned, setScanned] = useState<string | null>(null)
  const token = params.get('t') ?? scanned ?? ''
  const isStaff = role != null && STAFF_ROLES.includes(role)

  // Проверка гасит одноразовый QR-токен, то есть это действие, а не чтение: повтор того же
  // токена сервер отклоняет как уже проверенный. Поэтому результат не перезапрашивается ни
  // по времени, ни при возврате на вкладку или в сеть, ни ресинком после реконнекта сокета.
  const q = useQuery({
    queryKey: studentIdKeys.verify(token),
    queryFn: () => verifyStudentId(token),
    enabled: token.length > 0,
    retry: false,
    // Результат проверки — снимок на момент скана: при возврате на экран не перезапрашиваем,
    // иначе код успевает истечь, и охрана видит отказ вместо уже выданного «Пропустить».
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: NO_RESYNC_META,
  })

  // Нет токена: сотруднику показываем встроенный сканер камеры; остальным — подсказку.
  if (!token) {
    if (isStaff) {
      // Иммерсивный сканер сам показывает заголовок/подсказку — PageHeader не дублируем.
      // Ширину и высоту не ограничиваем: чем крупнее кадр камеры, тем легче навести
      // на QR — на телефоне это вся область контента, на десктопе тоже.
      return (
        <div className="flex w-full flex-1 flex-col">
          <QrScanner
            title={t('scanTitle')}
            hint={t('scanHint')}
            rejectNotice={tScan('notStudentId')}
            onScan={(raw) => {
              // Здесь проверяют только билеты: вход, отметка и наклейки — в общем сканере.
              const target = parseQrTarget(raw)
              if (target?.kind !== 'studentId') return false
              setScanned(target.value)
              return true
            }}
          />
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
    const code = q.error ? toApiError(q.error).code : null
    return (
      <CenterCard>
        <TriangleAlert className="size-10 text-destructive" aria-hidden />
        {/* Охране отказ проверки — это отказ в проходе: так и пишем, крупно. */}
        {role === Role.SECURITY_GUARD && (
          <p className="text-xl font-bold text-destructive">{t('entryDenied')}</p>
        )}
        <h1 className="text-lg font-semibold">{t('verifyFailed')}</h1>
        <p className="text-sm text-muted-foreground">
          {/* QR — разовый пропуск: код, уже проверенный другим сотрудником, отвечает 409.
              Битый, чужой или истёкший код сервер отдаёт как UNAUTHORIZED / BAD_REQUEST, и
              общие переводы этих кодов («Неверный email или пароль», «Некорректный
              запрос») здесь врут — это «код недействителен или истёк». */}
          {code === 'CONFLICT'
            ? t('verifyAlreadyUsed')
            : code && code !== 'UNAUTHORIZED' && code !== 'BAD_REQUEST'
              ? tErr(code)
              : t('verifyFailedHint')}
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
      {/* Охране — решение о проходе крупно: на входе смотрят на него, а не на поля карты.
          Карта бывает настоящей, а пропускать по ней нельзя — отчислен, выпускник. */}
      {q.data.entry && (
        <div
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl p-4 text-lg font-bold',
            q.data.entry.allowed
              ? 'bg-success/15 text-success'
              : 'bg-destructive/15 text-destructive',
          )}
        >
          {q.data.entry.allowed ? (
            <ShieldCheck className="size-6" aria-hidden />
          ) : (
            <ShieldX className="size-6" aria-hidden />
          )}
          {q.data.entry.allowed ? t('entryAllowed') : t('entryDenied')}
        </div>
      )}
      {q.data.entry && !q.data.entry.allowed && (
        <p className="-mt-2 text-center text-sm text-destructive">{t('entryDeniedStatus')}</p>
      )}
      {/* Явный визуальный статус «✓ Подтверждено StudentHub». */}
      <div className="flex items-center justify-center gap-2 rounded-xl bg-success/10 p-3 text-sm font-semibold text-success">
        <BadgeCheck className="size-5" aria-hidden />
        {t('verifiedBadge')}
      </div>
      <StudentIdCardFace card={q.data} selfDeclared={q.data.selfDeclared} />
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
