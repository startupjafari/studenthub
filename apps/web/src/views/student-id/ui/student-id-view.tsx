'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Inbox, Maximize2, RefreshCw } from 'lucide-react'
import { Button, EmptyState, Modal, PageHeader, Skeleton } from '../../../shared/ui'
import { fetchMyStudentId, studentIdKeys } from '../../../entities/student-id'
import { StudentIdCardFace } from './student-id-card'

// QR обновляется каждые 45с (динамический токен, TTL на бэке ~120с). Держим интервал в
// диапазоне 30-60с из требований и заметно короче TTL, чтобы код не «истекал в руках».
const REFRESH_SECONDS = 45

// «Цифровой студенческий» (задача 20): карта студента + динамический QR для верификации.
export function StudentIdView() {
  const t = useTranslations('StudentId')

  const q = useQuery({
    queryKey: studentIdKeys.mine(),
    queryFn: () => fetchMyStudentId(),
    // Тихо обновляем токен/QR (данные карты те же — без скелета, keepPreviousData по умолчанию
    // для того же ключа: React Query отдаёт прежние данные, пока грузится новые).
    refetchInterval: REFRESH_SECONDS * 1000,
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
          footer={<QrPanel qr={q.data.qr} updatedAt={q.dataUpdatedAt} />}
        />
      )}
    </div>
  )
}

// Секунды до следующего обновления QR: считаем от момента последнего успешного refetch.
function useCountdown(fromTs: number, seconds: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, seconds - Math.floor((now - fromTs) / 1000))
}

function QrPanel({ qr, updatedAt }: { qr: string; updatedAt: number }) {
  const t = useTranslations('StudentId')
  const [open, setOpen] = useState(false)
  const remaining = useCountdown(updatedAt, REFRESH_SECONDS)

  return (
    <div className="relative z-30 flex flex-col items-center gap-2 border-t border-border p-5">
      {/* Компактный QR, тап — крупнее (модалка). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('qrEnlarge')}
        className="group relative rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
      >
        <img
          src={qr}
          alt={t('qrAlt')}
          width={144}
          height={144}
          className="aspect-square w-36 rounded-xl border border-border bg-white p-2 transition group-hover:opacity-90"
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-foreground/70 p-1 text-background">
          <Maximize2 className="size-3.5" aria-hidden />
        </span>
      </button>

      {/* Таймер до обновления QR. */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5" aria-hidden />
        {t('refreshIn', { s: remaining })}
      </div>
      <p className="text-center text-xs text-muted-foreground">{t('qrHint')}</p>

      {open && (
        <Modal onClose={() => setOpen(false)} title={t('qrTitle')} size="md">
          <div className="flex flex-col items-center gap-3">
            <img
              src={qr}
              alt={t('qrAlt')}
              className="aspect-square w-full max-w-xs rounded-xl border border-border bg-white p-3"
            />
            <p className="text-center text-xs text-muted-foreground">{t('qrHint')}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
