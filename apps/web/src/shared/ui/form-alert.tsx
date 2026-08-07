'use client'

import { useTranslations } from 'next-intl'
import { TriangleAlert } from 'lucide-react'
import type { ApiErrorBody } from '@studenthub/shared-types'
import { Alert, AlertDescription, AlertTitle } from './alert'

export interface FormAlertProps {
  error: ApiErrorBody | null
  className?: string
}

// Единый alert серверной ошибки для форм. Заголовок — локализованный текст по code (§5.4/§10),
// для VALIDATION_ERROR дополнительно перечисляет поля из details[] (§7 — но списком, не под полями).
export function FormAlert({ error, className }: FormAlertProps) {
  const tErr = useTranslations('Errors')
  if (!error) return null

  const details = error.code === 'VALIDATION_ERROR' ? error.details : undefined

  return (
    <Alert variant="destructive" className={className}>
      <TriangleAlert aria-hidden />
      <AlertTitle>{tErr(error.code)}</AlertTitle>
      {details && details.length > 0 && (
        <AlertDescription>
          <ul className="list-inside list-disc">
            {details.map((detail, index) => (
              <li key={`${detail.field}-${index}`}>{detail.message}</li>
            ))}
          </ul>
        </AlertDescription>
      )}
    </Alert>
  )
}
