// Инициализация Sentry в браузере (Ф13.8). Next подхватывает этот файл автоматически
// и грузит его до кода приложения. Без NEXT_PUBLIC_SENTRY_DSN не делаем ничего:
// в dev и в e2e трекер молчит.
//
// SDK — динамическим импортом (задача 21.B4). Статический клал ~90 КБ в бандл каждой
// страницы, даже когда DSN нет и трекер выключен; на слабом телефоне это сотни
// миллисекунд разбора до первой отрисовки. DSN — переменная сборки, так что без него
// ветка вырезается вместе с импортом. С DSN загрузка начинается здесь же, раньше кода
// приложения, но завершается асинхронно: ошибка в первые миллисекунды до инициализации
// может не дойти до трекера — плата за то, что выключенный трекер ничего не стоит.
import type * as SentryModule from '@sentry/nextjs'
import { sentryEnabled, sharedSentryOptions } from 'shared/lib/sentry-options'

let sentry: typeof SentryModule | undefined

if (sentryEnabled) {
  void import('@sentry/nextjs').then((module) => {
    module.init(sharedSentryOptions())
    sentry = module
  })
}

// Обязателен для корректной привязки ошибок к переходам App Router.
export const onRouterTransitionStart: typeof SentryModule.captureRouterTransitionStart = (
  ...args
) => sentry?.captureRouterTransitionStart(...args)
