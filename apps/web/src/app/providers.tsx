'use client'

import { useState, type ReactNode } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { store } from '../shared/store'
import { makeQueryClient } from '../shared/api'
import { SessionInitializer } from '../shared/session'
import { RealtimeProvider } from '../shared/realtime'
import { ConfirmProvider, Toaster, TooltipProvider } from '../shared/ui'
import { CommandPalette } from '../widgets/command-palette'

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
        {/* Тема: класс .dark на <html> (next-themes). Токены — в globals.css. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
            <SessionInitializer />
            <RealtimeProvider>
              <TooltipProvider delayDuration={200}>
                <ConfirmProvider>
                  {children}
                  <CommandPalette />
                  {/* Toaster внутри ThemeProvider — тосты следуют выбранной теме (useTheme). */}
                  <Toaster />
                </ConfirmProvider>
              </TooltipProvider>
            </RealtimeProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ReduxProvider>
  )
}
