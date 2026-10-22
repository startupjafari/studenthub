'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { Skeleton } from '../../../shared/ui'
import { parseQrTarget } from '../../../features/qr-scan'

// Камера — только на клиенте: на сервере ни видео, ни getUserMedia нет.
const QrScanner = dynamic(() => import('../../../features/qr-scan').then((m) => m.QrScanner), {
  ssr: false,
  loading: () => <Skeleton className="min-h-0 w-full flex-1 rounded-3xl" />,
})

/**
 * Единый сканер QR StudentHub. Один вход вместо отдельной камеры на каждый случай: вход на
 * компьютере, студенческий, отметка на паре, наклейка помещения, выданная справка, резюме,
 * приглашение в чат. Узнав код, сканер уводит на экран этого сценария. Права проверяет
 * сам экран и сервер: например, студенческий откроется только у сотрудника.
 * Чужие QR (Wi-Fi, реклама, произвольные сайты) не открываются вовсе: сканер внутри
 * закрытой платформы не должен уводить на посторонние страницы.
 */
export function QrScanView() {
  const t = useTranslations('QrScan')
  const role = useAppSelector((s) => s.auth.role)
  const router = useRouter()

  return (
    <div className="flex w-full flex-1 flex-col">
      <QrScanner
        title={t('title')}
        hint={t('hint')}
        rejectNotice={t('notStudentHub')}
        onScan={(raw) => {
          const target = parseQrTarget(raw)
          if (!target) return false
          // Библиотекарю студенческий нужен для выдачи книг, а не для проверки на входе.
          if (role === Role.LIBRARIAN && target.kind === 'studentId') {
            router.push(`/library/issue?t=${encodeURIComponent(target.value)}`)
            return true
          }
          router.push(target.href)
          return true
        }}
      />
    </div>
  )
}
