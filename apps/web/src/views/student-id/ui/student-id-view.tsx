'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import { Button, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { fetchMyStudentId, studentIdKeys } from '../../../entities/student-id'
import { StudentIdCardFace } from './student-id-card'

// «Цифровой студенческий» (задача 20): карта студента + QR для верификации сотрудником.
export function StudentIdView() {
  const t = useTranslations('StudentId')

  const q = useQuery({
    queryKey: studentIdKeys.mine(),
    queryFn: () => fetchMyStudentId(),
    // Токен в QR короткоживущий — обновляем карту, чтобы код оставался действительным.
    refetchInterval: 4 * 60_000,
  })

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : q.isError || !q.data ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (
        <StudentIdCardFace
          card={q.data}
          footer={
            <div className="flex flex-col items-center gap-2 border-t border-border p-5">
              <img
                src={q.data.qr}
                alt={t('qrAlt')}
                width={192}
                height={192}
                className="aspect-square w-full max-w-48 rounded-xl border border-border bg-white p-2"
              />
              <p className="text-center text-xs text-muted-foreground">{t('qrHint')}</p>
            </div>
          }
        />
      )}
    </div>
  )
}
