'use client'

import { useCallback, useState } from 'react'
import type { ApiErrorBody } from '@studenthub/shared-types'
import { toApiError } from './api-error'

// Состояние alert'а формы: серверная ошибка последней отправки (docs/FRONTEND_RULES.md §5.4/§7).
// show(err) — вызвать в catch/onError мутации; reset() — при новой отправке.
export interface FormAlertController {
  error: ApiErrorBody | null
  show: (error: unknown) => void
  reset: () => void
}

export function useFormAlert(): FormAlertController {
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const show = useCallback((e: unknown) => setError(toApiError(e)), [])
  const reset = useCallback(() => setError(null), [])
  return { error, show, reset }
}
