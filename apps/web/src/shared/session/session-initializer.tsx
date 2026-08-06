'use client'

import { useEffect, useRef } from 'react'
import { useAppSelector } from '../store/hooks'
import { restoreSession } from './session'

// После перезагрузки access-токена в памяти нет — тихо восстанавливаем сессию
// через refresh по httpOnly cookie, чтобы API-запросы получили Bearer.
export function SessionInitializer() {
  const accessToken = useAppSelector((s) => s.auth.accessToken)
  const tried = useRef(false)

  useEffect(() => {
    if (!accessToken && !tried.current) {
      tried.current = true
      void restoreSession()
    }
  }, [accessToken])

  return null
}
