'use client'

import { useState, type ReactNode } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { store } from '../shared/store'
import { makeQueryClient } from '../shared/api'
import { SessionInitializer } from '../shared/session'
import { RealtimeProvider } from '../shared/realtime'
import { ConfirmProvider } from '../shared/ui'

interface AppProvidersProps {
  locale: string
  messages: AbstractIntlMessages
  timeZone: string
  children: ReactNode
}

// Клиентские провайдеры: Redux (auth+ui), React Query (серверные данные), next-intl.
export function AppProviders({ locale, messages, timeZone, children }: AppProvidersProps) {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
          <SessionInitializer />
          <RealtimeProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </RealtimeProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    </ReduxProvider>
  )
}
