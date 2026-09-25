'use client'

import { useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
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
// Ради побочного эффекта: модуль вешает слушатель `beforeinstallprompt` на уровне
// импорта. Событие прилетает сразу после загрузки — подписка из компонента настроек
// его бы уже не застала (shared/lib/pwa-install.ts).
import '../shared/lib/pwa-install'
import {
  useChunkErrorRecovery,
  useEscapeBack,
  useKeyboardInset,
  useSeasonTheme,
  useServiceWorkerUpdate,
} from '../shared/lib'

// Окно «Что нового» отдельным чанком: тексты релизов растут с каждым выпуском, а нужны
// они раз в релиз и только тем, кто ещё не читал. ssr: false — окно зависит от состояния
// сессии, на сервере его рисовать не в чем.
const WhatsNewDialog = dynamic(() => import('../widgets/whats-new').then((m) => m.WhatsNewDialog), {
  ssr: false,
})

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
            <AppRuntime />
            <RealtimeProvider>
              <TooltipProvider delayDuration={200}>
                <ConfirmProvider>
                  {children}
                  <CommandPalette />
                  <WhatsNewDialog />
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

// Общие эффекты приложения: обновление версии, высота клавиатуры, праздничное
// оформление. Отдельным компонентом, а не хуками в AppProviders: тост об обновлении
// берёт переводы, а сезон — таймзону платформы, и `NextIntlClientProvider` стоит ниже
// по дереву.
function AppRuntime() {
  useServiceWorkerUpdate()
  useChunkErrorRecovery()
  useKeyboardInset()
  useEscapeBack()
  // Праздник ставит `data-season` на <html>; дальше всё живёт в globals.css.
  useSeasonTheme()
  return null
}
