'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { RefreshCw } from 'lucide-react'
import { Button, Modal, Skeleton } from '../../../shared/ui'
import { attendanceKeys, fetchAttendanceQr } from '../../../entities/attendance'

interface Props {
  pairId: string
  date: string
  onClose: () => void
}

// Модалка QR занятия для преподавателя: студенты сканируют камерой → самоотметка.
// Токен короткоживущий, поэтому автообновляем и синхронизируем ростер.
export function AttendanceQrModal({ pairId, date, onClose }: Props) {
  const t = useTranslations('Attendance')
  const qc = useQueryClient()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const q = useQuery({
    queryKey: attendanceKeys.qr(pairId, date),
    queryFn: () => fetchAttendanceQr(pairId, date),
    // Обновляем токен чуть раньше истечения (TTL 90с) и подтягиваем новые самоотметки в ростер.
    refetchInterval: 60_000,
  })

  // Локальный обратный отсчёт до истечения текущего токена.
  useEffect(() => {
    if (!q.data) return
    const target = new Date(q.data.expiresAt).getTime()
    const tick = () => setSecondsLeft(Math.max(0, Math.round((target - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [q.data])

  // При каждом новом токене освежаем ростер — появятся только что отметившиеся студенты.
  useEffect(() => {
    if (q.data) qc.invalidateQueries({ queryKey: attendanceKeys.roster(pairId, date) })
  }, [q.data, qc, pairId, date])

  return (
    // `size="md"`: по умолчанию окно 42rem, а содержимого в нём — код 16rem и строка
    // текста. Код висел посреди пустого поля, а кнопка растягивалась на всю ширину,
    // и ни один край не совпадал ни с одним другим.
    <Modal onClose={onClose} title={t('qrTitle')} size="md">
      {/* Всё в колонке ШИРИНОЙ С КОД: подпись, сам код, строка обновления и кнопка
          выровнены по одним краям — сравнивать нечего, потому что ширина одна. */}
      <div className="mx-auto flex w-full max-w-64 flex-col items-center gap-4">
        <p className="text-center text-sm text-balance text-muted-foreground">{t('qrHint')}</p>

        {q.isLoading || !q.data ? (
          <Skeleton className="aspect-square w-full rounded-xl" />
        ) : (
          <img
            src={q.data.qr}
            alt={t('qrTitle')}
            width={256}
            height={256}
            className="aspect-square w-full rounded-xl border border-border bg-white p-2"
          />
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {secondsLeft !== null && <span>{t('qrExpiresIn', { s: secondsLeft })}</span>}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => q.refetch()}
            loading={q.isFetching}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {t('qrRefresh')}
          </Button>
        </div>

        <Button variant="outline" className="w-full" onClick={onClose}>
          {t('qrDone')}
        </Button>
      </div>
    </Modal>
  )
}
