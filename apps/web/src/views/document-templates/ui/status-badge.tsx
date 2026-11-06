'use client'

import { useTranslations } from 'next-intl'
import type { DocumentTemplateStatus } from '@studenthub/shared-schemas'
import { Badge } from '../../../shared/ui'

const VARIANT = {
  DRAFT: 'secondary',
  PUBLISHED: 'success',
  ARCHIVED: 'outline',
} as const satisfies Record<DocumentTemplateStatus, 'secondary' | 'success' | 'outline'>

export function StatusBadge({ status }: { status: DocumentTemplateStatus }) {
  const t = useTranslations('DocumentTemplates')
  return <Badge variant={VARIANT[status]}>{t(`status_${status}`)}</Badge>
}
