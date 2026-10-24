'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Inbox, Maximize2, RefreshCw } from 'lucide-react'
import { Button, EmptyState, Modal, PageHeader, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
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
    // Интервал в фоне не тикает: после заблокированного экрана код на руках старше TTL, а
    // охрана видит «Код истёк». Возврат на вкладку обновляет код, если он старше интервала.
    staleTime: REFRESH_SECONDS * 1000,
    refetchOnWindowFocus: true,
  })

  // Плашка ошибки — единственное содержимое страницы, и колонка должна отдать ей всю
  // высоту `main`. Карточке и скелету `flex-1` не нужен: у них своя высота, а в
  // растянутой колонке они бы ещё и сжимались на низких экранах (§4).
  const placeholder = !q.isLoading && (q.isError || !q.data)

  return (
    <div className={cn('flex w-full flex-col gap-6', placeholder && 'min-h-0 flex-1')}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl lg:h-[26rem]" />
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
            <QrPanel
              qr={q.data.qr}
              expiresAt={q.data.expiresAt}
              updatedAt={q.dataUpdatedAt}
              refreshing={q.isFetching}
              onRefresh={() => void q.refetch()}
            />
          }
        />
      )}
    </div>
  )
}

// Текущее время с шагом в секунду — для таймера и проверки срока кода.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function QrPanel({
  qr,
  expiresAt,
  updatedAt,
  refreshing,
  onRefresh,
}: {
  qr: string
  expiresAt: string
  updatedAt: number
  refreshing: boolean
  onRefresh: () => void
}) {
  const t = useTranslations('StudentId')
  const [open, setOpen] = useState(false)
  const now = useNow()
  // Секунды до следующего обновления QR: считаем от момента последнего успешного refetch.
  const remaining = Math.max(0, REFRESH_SECONDS - Math.floor((now - updatedAt) / 1000))
  // Просроченный код не показываем как действующий: охрана его всё равно отклонит.
  const expired = now >= Date.parse(expiresAt)

  return (
    <div className="relative z-30 flex flex-col items-center justify-center gap-2 border-t border-border p-5 lg:h-full lg:border-t-0 lg:border-l">
      {/* QR крупный — его показывают с экрана телефона сотруднику; тап открывает
          модалку на весь экран, когда света мало и камера не ловит. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('qrEnlarge')}
        className="group relative rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
      >
        <img
          src={qr}
          alt={t('qrAlt')}
          width={288}
          height={288}
          className={cn(
            'aspect-square w-72 max-w-full rounded-xl border border-border bg-white p-3 transition group-hover:opacity-90',
            expired && 'opacity-20 blur-sm',
          )}
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-foreground/70 p-1 text-background">
          <Maximize2 className="size-3.5" aria-hidden />
        </span>
      </button>

      {/* Таймер до обновления QR; код устарел (обновление не дошло) — ручное обновление. */}
      {expired ? (
        <Button size="sm" variant="outline" loading={refreshing} onClick={onRefresh}>
          <RefreshCw className="size-3.5" aria-hidden />
          {t('qrExpiredRefresh')}
        </Button>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="size-3.5" aria-hidden />
          {t('refreshIn', { s: remaining })}
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">{t('qrHint')}</p>

      {open && (
        <Modal onClose={() => setOpen(false)} title={t('qrTitle')} size="md">
          <div className="flex flex-col items-center gap-3">
            <img
              src={qr}
              alt={t('qrAlt')}
              className="aspect-square w-full max-w-sm rounded-xl border border-border bg-white p-3"
            />
            <p className="text-center text-xs text-muted-foreground">{t('qrHint')}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
