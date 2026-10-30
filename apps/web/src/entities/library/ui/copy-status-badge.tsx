'use client'

import { useTranslations } from 'next-intl'
import type { BookCopyStatusValue } from '@studenthub/shared-schemas'
import { Badge } from '../../../shared/ui'

const VARIANT: Record<
  BookCopyStatusValue,
  'success' | 'info' | 'warning' | 'secondary' | 'destructive'
> = {
  AVAILABLE: 'success',
  ON_LOAN: 'info',
  RESERVED: 'warning',
  LOST: 'destructive',
  WRITTEN_OFF: 'secondary',
}

/** Статус экземпляра: на полке, выдан, отложен под бронь, утерян, списан. */
export function CopyStatusBadge({ status }: { status: BookCopyStatusValue }) {
  const t = useTranslations('LibraryCatalog')
  const label: Record<BookCopyStatusValue, string> = {
    AVAILABLE: t('status.AVAILABLE'),
    ON_LOAN: t('status.ON_LOAN'),
    RESERVED: t('status.RESERVED'),
    LOST: t('status.LOST'),
    WRITTEN_OFF: t('status.WRITTEN_OFF'),
  }
  return <Badge variant={VARIANT[status]}>{label[status]}</Badge>
}
