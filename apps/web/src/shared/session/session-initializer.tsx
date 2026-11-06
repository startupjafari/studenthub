'use client'

import { useEffect, useRef } from 'react'
import { useAppSelector } from '../store/hooks'
import { store } from '../store/store'
import { clearAuth } from '../store/auth-slice'
import { restoreSession } from './session'
import { onLogoutElsewhere } from './session-channel'

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

  // Выход в соседней вкладке гасит и эту (FRONTEND_RULES §6): токен из памяти, затем полная
  // загрузка входа — она же сбрасывает кэш React Query, сокет и всё, что на экране.
  useEffect(
    () =>
      onLogoutElsewhere(() => {
        if (!store.getState().auth.accessToken) return
        store.dispatch(clearAuth())
        window.location.assign('/login')
      }),
    [],
  )

  return null
}
