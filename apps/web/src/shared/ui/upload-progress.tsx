'use client'

import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './button'
import { Progress } from './progress'

export interface UploadProgressProps {
  /** Сколько отправлено, 0–100. */
  percent: number
  /** Отмена загрузки; без неё крестика нет. */
  onCancel?: () => void
  className?: string
}

/**
 * Строка хода загрузки: полоса, подпись с процентами и крестик отмены. Для экранов, где файл
 * выбирают кнопкой, а не зоной `FileUpload`, — крупный скан или запись лекции идут минутами,
 * и одного спиннера на кнопке для них мало.
 */
export function UploadProgress({ percent, onCancel, className }: UploadProgressProps) {
  const t = useTranslations('FileUpload')
  const label = t('uploading', { percent })
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
        <Progress value={percent} aria-label={label} />
      </div>
      {onCancel && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon
          aria-label={t('cancel')}
          onClick={onCancel}
        >
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
